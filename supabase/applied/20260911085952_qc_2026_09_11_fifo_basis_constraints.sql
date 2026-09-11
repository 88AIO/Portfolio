-- QC 2026-09-11: FIFO cost basis view, user-scoped split overrides, integrity constraints,
-- consent_log FK index, cleared raw broker payloads. Extracted verbatim from supabase/schema.sql.

create index if not exists consent_log_user_idx on public.consent_log(user_id);

-- Integrity the views assume. Every reader branches on `type` and multiplies by `quantity`; a row
-- outside these sets would be silently ignored by one page and counted by another. Added with a
-- guard so re-running the file on a database that already has them is a no-op.
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'transactions_type_check') then
    alter table public.transactions add constraint transactions_type_check
      check (type in ('buy', 'sell', 'dividend', 'deposit', 'withdrawal'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'transactions_quantity_positive') then
    alter table public.transactions add constraint transactions_quantity_positive check (quantity > 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'transactions_price_nonnegative') then
    alter table public.transactions add constraint transactions_price_nonnegative check (price >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'transactions_currency_code') then
    alter table public.transactions add constraint transactions_currency_code check (currency ~ '^[A-Z]{3}$');
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'option_transactions_action_check') then
    alter table public.option_transactions add constraint option_transactions_action_check
      check (action in ('sell_to_open', 'buy_to_close', 'expired', 'assigned', 'rolled'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'option_transactions_type_check') then
    alter table public.option_transactions add constraint option_transactions_type_check
      check (option_type in ('put', 'call'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'option_transactions_contracts_positive') then
    alter table public.option_transactions add constraint option_transactions_contracts_positive check (contracts > 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'option_transactions_premium_nonnegative') then
    -- Premium is entered as a positive per-share amount; the action carries the direction.
    alter table public.option_transactions add constraint option_transactions_premium_nonnegative check (premium >= 0);
  end if;
end $$;

-- ============================================================
-- POSITIONS view — computes Snowball-style holding fields
-- from transactions. Column names kept backward-compatible
-- (shares, avg_cost, last_price, day_change_pct) and extended.
-- Net option premium is exposed as its own option_premium column
-- and deliberately NOT folded into avg_cost/cost_basis/gain_value
-- (see the note on option_premium below — folding it in
-- double-counted the same dollars). The "premium lowers my cost"
-- framing lives only in the holding-detail display math.
--
-- Cost basis is FIFO over the lots still held, NOT the lifetime average of every buy. The old
-- buy_value / buy_shares average never let go of shares that had already been sold: assigned 100
-- @ $50, called away @ $55, assigned again 100 @ $52 printed a $51 cost and a $200 gain on a lot
-- that cost $52 and had gained $100 — and double-counted $100 of the realized gain the holding
-- page shows beside it. One full wheel cycle was enough to make every headline number wrong for
-- the exact person this product is built for. FIFO here matches lib/tax/realized.ts (the TS twin
-- that computes realized lots and, via computeOpenLots, the same open-lot basis) — change both.
-- ============================================================
drop view if exists public.positions cascade;
drop view if exists public.positions_all cascade;
create view public.positions_all with (security_invoker = on) as
with opt as (
  -- Net premium kept per underlying: credits (sell_to_open) minus debits (buy_to_close/rolled),
  -- fees always a cost. Premium is signed by action here — the raw `premium` column is entered
  -- as a positive per-share number regardless of direction.
  -- Mirrors legPremium() in lib/options.ts — change both together.
  select portfolio_id, instrument_id, sum(
    case when action = 'sell_to_open' then premium*contracts*100 - fee
         when action in ('buy_to_close','rolled') then -(premium*contracts*100) - fee
         else -fee end
  ) as option_premium
  from public.option_transactions
  group by portfolio_id, instrument_id
),
-- A user's own split entries, one per (user, instrument, ex-date). They are entered against one
-- portfolio but describe the instrument, so they apply to every portfolio that user holds it in —
-- the same rule lib/corporate/load.ts follows (it loads a user's rows with no portfolio filter).
-- Scoping them per portfolio here made the dashboard and the holding page disagree on a share
-- count the moment a holding lived in a broker-synced second account. If two of a user's
-- portfolios carry different ratios for the same date, the newest entry wins (twin of mergeSplits).
user_splits as (
  select distinct on (op.user_id, o.instrument_id, o.ex_date)
         op.user_id, o.instrument_id, o.ex_date, o.ratio
    from public.portfolio_splits o
    join public.portfolios op on op.id = o.portfolio_id
   order by op.user_id, o.instrument_id, o.ex_date, o.created_at desc
),
tx as (
  -- Every ledger row restated in TODAY'S shares. A quantity recorded before a split is scaled by
  -- every split that has happened since. Money columns are deliberately NOT scaled — a split
  -- changes how many pieces you hold, never what you paid or what you were paid — so `gross` and
  -- `buy_cost` are split-invariant by construction.
  --
  -- The strict inequality on ex_date matters: a trade executed ON the ex-date already prices and
  -- counts in post-split shares, so only splits strictly AFTER a row apply to it.
  select
    t.id, t.portfolio_id, t.instrument_id, t.type, t.executed_at, t.created_at, t.fees,
    t.quantity * sf.factor        as qty,       -- today's shares
    t.quantity * t.price          as gross,     -- money, as traded
    t.quantity * t.price + t.fees as buy_cost   -- money incl. commission (meaningful on buys)
  from public.transactions t
  join public.portfolios tp on tp.id = t.portfolio_id
  left join lateral (
    -- The shared provider rows, plus this user's own entries. A user row on the same ex-date
    -- REPLACES the provider's rather than compounding with it — two rows for one split would
    -- multiply the share count twice, which is a worse error than the gap it was added to fill.
    select public.product(s.ratio) as factor
    from (
      select g.ex_date, g.ratio
        from public.instrument_splits g
       where g.instrument_id = t.instrument_id
         and not exists (
           select 1 from user_splits u
            where u.user_id = tp.user_id
              and u.instrument_id = t.instrument_id
              and u.ex_date = g.ex_date
         )
      union all
      select u.ex_date, u.ratio
        from user_splits u
       where u.user_id = tp.user_id
         and u.instrument_id = t.instrument_id
    ) s
    where s.ex_date > t.executed_at
      -- Broker-reconciled rows are ALREADY in today's shares: the sync writes one opening-balance
      -- lot per held instrument to absorb transfers-in, pre-window shares and past splits, sized to
      -- the broker's current position. Adjusting it again would multiply a real holding by the
      -- split a second time. Twin of lib/brokersync/restated.ts.
      and coalesce(t.dedupe_key, '') not like 'ref:snaptrade-recon:%'
      and coalesce(t.dedupe_key, '') not like 'ref:snaptrade-pos:%'
  ) sf on true
  where t.type in ('buy', 'sell', 'dividend')
),
sold as (
  select portfolio_id, instrument_id, sum(qty) as sold_qty
    from tx where type = 'sell'
   group by portfolio_id, instrument_id
),
-- FIFO without a loop: sells always consume the OLDEST shares, so the shares still held are the
-- LAST (total bought − total sold) shares in purchase order. For each buy lot, the part still
-- open is however much of it sits above that sold total on the running-total line.
lots as (
  select b.portfolio_id, b.instrument_id, b.qty, b.buy_cost,
         sum(b.qty) over (
           partition by b.portfolio_id, b.instrument_id
           order by b.executed_at, b.created_at, b.id
           rows between unbounded preceding and current row
         ) as cum_qty
    from tx b
   where b.type = 'buy'
),
basis as (
  select l.portfolio_id, l.instrument_id,
         sum(greatest(0, least(l.qty, l.cum_qty - coalesce(s.sold_qty, 0)))) as open_shares,
         sum(case when l.qty > 0
                  then l.buy_cost * greatest(0, least(l.qty, l.cum_qty - coalesce(s.sold_qty, 0))) / l.qty
                  else 0 end) as open_cost
    from lots l
    left join sold s on s.portfolio_id = l.portfolio_id and s.instrument_id = l.instrument_id
   group by l.portfolio_id, l.instrument_id
),
agg as (
  select
    portfolio_id,
    instrument_id,
    sum(case when type = 'buy' then qty when type = 'sell' then -qty else 0 end) as shares,
    sum(case when type = 'buy' then buy_cost else 0 end)                         as buy_value,
    sum(case when type = 'buy' then qty else 0 end)                              as buy_shares,
    sum(fees)                                                                    as commission_paid,
    sum(case when type = 'dividend' then gross else 0 end)                       as div_paid,
    sum(case when type = 'sell' then gross - fees else 0 end)                    as sell_proceeds
  from tx
  group by portfolio_id, instrument_id
)
select
  a.portfolio_id,
  i.id                as instrument_id,
  i.symbol,
  i.exchange,
  i.name,
  i.type,
  i.currency,
  i.sector,
  i.sector_weights,
  i.country_iso,
  i.logo_url,
  i.div_rating,
  a.shares,
  -- Net option premium collected on this underlying (signed), exposed for the options/income
  -- views. NOTE: it is deliberately NOT folded into avg_cost/cost_basis/gain_value — equity P/L
  -- here is pure share economics (matches a broker statement), and option premium is counted once
  -- as its own income line. Folding it in double-counted the same dollars as both a basis
  -- reduction and premium income.
  coalesce(o.option_premium,0) as option_premium,
  -- Cost of the shares still held (FIFO), per share and in total.
  case when coalesce(b.open_shares, 0) > 0 then b.open_cost / b.open_shares else 0 end as avg_cost,
  a.buy_value,
  a.commission_paid,
  a.div_paid,
  pc.price            as last_price,
  pc.change_pct       as day_change_pct,
  pc.as_of            as price_as_of,
  (pc.price * a.shares)                          as current_total_price,
  coalesce(b.open_cost, 0)                       as cost_basis,
  (pc.price * a.shares) - coalesce(b.open_cost, 0) as gain_value,
  -- What the shares already sold made: proceeds net of the sale's fees, less the cost of the
  -- lots they consumed (everything bought minus what is still open). Twin of summarizeRealized().
  a.sell_proceeds - (a.buy_value - coalesce(b.open_cost, 0)) as realized_gain,
  -- forward dividend income & current yield from instrument reference
  (coalesce(i.annual_div_per_share,0) * a.shares)                                  as year_total_divs,
  case when pc.price > 0 then coalesce(i.annual_div_per_share,0)/pc.price*100 else null end as div_yield_current,
  i.annual_div_per_share,
  i.div_yield_ttm,
  i.div_frequency,
  i.ex_dividend_date,
  i.next_dividend_date,
  i.next_dividend_per_share
from agg a
join public.instruments i on i.id = a.instrument_id
left join basis b on b.portfolio_id = a.portfolio_id and b.instrument_id = a.instrument_id
left join public.price_cache pc on pc.instrument_id = i.id
left join opt o on o.portfolio_id = a.portfolio_id and o.instrument_id = a.instrument_id;

-- Live holdings only. A round-tripped holding can net to floating-point dust (e.g. 3e-15 shares)
-- rather than exactly 0, which would otherwise show as a junk "0.0000 · $0" row in the by-account
-- view. 1e-9 is far below any real holding, including satoshi-level crypto. positions_all keeps
-- the fully-closed rows: their realized_gain and div_paid are what a finished wheel cycle earned,
-- and the dashboard's "Total earned" reads them from there.
create view public.positions with (security_invoker = on) as
select * from public.positions_all where abs(shares) > 1e-9;

-- PORTFOLIO TOTALS view --------------------------------------
-- Blueprint mirror consumed only by the CI RLS-isolation test (tests/rls.test.mjs). The app
-- computes totals in TypeScript with per-currency FX (app/dashboard/page.tsx) — this view sums
-- mixed currencies naively, so NEVER wire it into the UI without adding FX conversion first.
drop view if exists public.portfolio_totals;
create view public.portfolio_totals with (security_invoker = on) as
select
  portfolio_id,
  count(*)                          as holdings_count,
  sum(cost_basis)                   as total_cost,
  sum(current_total_price)          as market_value,
  sum(gain_value)                   as total_gain_value,
  sum(div_paid)                     as div_paid,
  sum(year_total_divs)              as year_total_divs,
  sum(commission_paid)              as commission_paid
from public.positions
group by portfolio_id;

-- ============================================================
-- OPTION POSITIONS view — nets option_transactions into open
-- positions per (underlying, type, strike, expiration).
-- Derived display fields (collateral, RoC, status, covered) are
-- computed in lib/options.ts from these rows. See SPEC_options-selling.md.
-- ============================================================
drop view if exists public.option_positions;
create view public.option_positions with (security_invoker = on) as
with legs as (
  select
    ot.portfolio_id, ot.instrument_id, ot.option_type, ot.strike, ot.expiration, ot.currency,
    sum(case when ot.action='sell_to_open' then ot.contracts
             when ot.action in ('buy_to_close','expired','assigned','rolled') then -ot.contracts
             else 0 end)                                            as net_contracts,
    sum(case when ot.action='sell_to_open' then ot.contracts else 0 end) as sold_contracts,
    -- Signed premium: credit on open, debit on close/roll, fees always a cost.
    -- Mirrors legPremium() in lib/options.ts — change both together.
    sum(case when ot.action='sell_to_open' then ot.premium*ot.contracts*100 - ot.fee
             when ot.action in ('buy_to_close','rolled') then -(ot.premium*ot.contracts*100) - ot.fee
             else -ot.fee end)                                     as premium_net,
    min(ot.trade_date)                                              as opened_at,
    max(ot.trade_date)                                              as last_action_at
  from public.option_transactions ot
  group by ot.portfolio_id, ot.instrument_id, ot.option_type, ot.strike, ot.expiration, ot.currency
)
select
  l.portfolio_id, l.instrument_id, i.symbol, i.exchange, i.name,
  l.option_type, l.strike, l.expiration, l.currency,
  l.net_contracts, l.sold_contracts, l.premium_net, l.opened_at, l.last_action_at,
  pc.price                    as underlying_price,
  coalesce(pos.shares, 0)     as underlying_shares,
  (l.expiration - current_date) as dte
from legs l
join public.instruments i on i.id = l.instrument_id
left join public.price_cache pc on pc.instrument_id = l.instrument_id
left join public.positions pos on pos.portfolio_id = l.portfolio_id and pos.instrument_id = l.instrument_id
-- A real leg must have an opening trade in our records. Broker/CSV imports sometimes carry a lone
-- expiry/assignment for an option whose sell_to_open was never imported, which nets to negative
-- contracts and would surface as a phantom "$0 finished trade". Require sold_contracts > 0.
where l.sold_contracts > 0;

alter table public.broker_accounts add column if not exists raw jsonb;
update public.broker_accounts set raw = null where raw is not null;
