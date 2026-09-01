-- ============================================================
-- Snowfolio — database schema v2 (modeled 1:1 on Snowball's /extapi/api)
-- Run in Supabase: SQL Editor -> New query -> paste -> Run.
-- Safe to re-run (idempotent-ish): drops/recreates the positions views.
-- ============================================================

-- 1. PROFILES ------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  base_currency text not null default 'USD',
  created_at timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email,'@',1)));
  return new;
end; $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users for each row execute function public.handle_new_user();

-- 2. PORTFOLIOS (mirrors Snowball's 38-field Portfolio config) -
-- LIVE columns today: id, user_id, name, base_currency, created_at (+ broker/sync_provider/
-- is_auto_sync_enabled, written by broker sync). Everything else — goals, tax config, composite
-- "pie" fields, sharing, view options — is RESERVED roadmap scaffolding mirrored from the
-- blueprint (CLAUDE.md): deliberately kept, near-zero cost as NULL/default columns, no app reader
-- or writer yet. Don't assume a config UI exists for them.
create table if not exists public.portfolios (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null default 'My Portfolio',
  note text,
  base_currency text not null default 'USD',   -- Snowball: defaultCurrency
  broker text,
  broker_commission numeric,
  "order" int not null default 0,
  hidden boolean not null default false,
  is_demo boolean not null default false,
  view_type int not null default 0,
  use_categories boolean not null default false,
  track_cash boolean not null default false,
  track_cash_type int not null default 0,
  remove_cash_assets boolean not null default false,
  -- Goals
  goal_type int not null default 0,
  goal_value numeric,
  goal_currency text,
  -- Tax / return config
  apply_taxes_on_paid_dividends boolean not null default false,
  dividend_tax_percent numeric not null default 0,
  do_not_adjust_xirr boolean not null default false,
  automatically_add_dividend boolean not null default true,
  dividend_go_to_another_account boolean not null default false,
  -- Composite ("pie") portfolios
  is_composite boolean not null default false,
  parent_portfolio_id uuid references public.portfolios(id) on delete set null,
  -- Broker sync
  is_auto_sync_enabled boolean not null default false,
  sync_provider text,
  setup_required boolean not null default false,
  -- Sharing
  share_is_public boolean not null default false,
  share_public_key text,
  created_at timestamptz not null default now()
);
create index if not exists portfolios_user_idx on public.portfolios(user_id);

-- 3. CATEGORIES (custom grouping, Snowball: useCategories) -----
create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  portfolio_id uuid not null references public.portfolios(id) on delete cascade,
  name text not null,
  target_percent numeric,
  "order" int not null default 0
);

-- 4. INSTRUMENTS (shared reference + fundamentals + div info) --
-- LIVE columns: symbol/exchange/name/currency/type (insert), sector/sector_weights/country_iso
-- (enrichment), and the dividend-reference block from the nightly sync. The fundamentals
-- (eps..expense_ratio), bond fields, isin/logo_url/ticker_with_exchange/div_rating/industry are
-- RESERVED blueprint mirrors — never written, permanently NULL today. div_rating is the natural
-- future cache slot for the safety score lib/dividends/safety.ts computes live.
create table if not exists public.instruments (
  id uuid primary key default gen_random_uuid(),
  symbol text not null,
  exchange text not null,
  ticker_with_exchange text,
  isin text,
  name text,
  type text default 'stock',      -- stock | etf | fund | bond | crypto | cash | custom
  currency text default 'USD',
  sector text,
  sector_weights jsonb,            -- ETF/fund look-through: [{sector, weight}] (weights sum ~1)
  industry text,
  country_iso text,
  logo_url text,
  -- Fundamentals (refreshed periodically from the data provider)
  eps numeric, pe numeric, payout numeric, beta numeric,
  market_cap_mln numeric, expense_ratio numeric,
  -- Dividend reference
  annual_div_per_share numeric,
  div_yield_ttm numeric,
  div_frequency int,               -- payments per year
  div_rating numeric,              -- Snowball's dividend-safety score
  ex_dividend_date date,
  next_dividend_date date,
  next_dividend_per_share numeric,
  -- Bond reference
  nominal numeric, coupon_rate numeric, maturity_date date, bond_type text,
  created_at timestamptz not null default now(),
  unique (symbol, exchange)
);

-- 5. TRANSACTIONS (source of truth) ---------------------------
create table if not exists public.transactions (
  id uuid primary key default gen_random_uuid(),
  portfolio_id uuid not null references public.portfolios(id) on delete cascade,
  instrument_id uuid not null references public.instruments(id),
  category_id uuid references public.categories(id) on delete set null,
  type text not null default 'buy',   -- buy | sell | dividend | deposit | withdrawal
  quantity numeric not null default 0,
  price numeric not null default 0,   -- per share, in trade currency
  fees numeric not null default 0,
  currency text not null default 'USD',
  executed_at date not null default current_date,
  note text,
  dedupe_key text,                    -- stable idempotency key (set by imports + manual adds)
  created_at timestamptz not null default now()
);
-- Backfill-safe for databases created before dedupe_key existed:
alter table public.transactions add column if not exists dedupe_key text;
-- A purchase made with dividend money rather than new cash. Kept as its own column rather than
-- inferred: matching small fractional buys against nearby dividend dates mislabels ordinary
-- purchases, and a wrongly tagged buy is worse than an untagged one.
alter table public.transactions add column if not exists drip boolean not null default false;
create index if not exists tx_portfolio_idx on public.transactions(portfolio_id);
-- The holding-detail page and delete guards filter by instrument_id (also serves the FK side).
create index if not exists tx_instrument_idx on public.transactions(instrument_id);
-- Idempotent imports: the same transaction never inserts twice within a portfolio.
-- (NULL keys are distinct in Postgres, so legacy rows without a key are unaffected.)
create unique index if not exists transactions_dedupe_uidx
  on public.transactions(portfolio_id, dedupe_key);

-- 6. PRICE CACHE ---------------------------------------------
create table if not exists public.price_cache (
  instrument_id uuid primary key references public.instruments(id) on delete cascade,
  price numeric,
  currency text,
  change_pct numeric,
  as_of timestamptz not null default now()
);

-- 6b. PRICE HISTORY (weekly closes, for performance charts) ---
-- Shared reference data like price_cache: service-role writes, authenticated read.
create table if not exists public.price_history (
  instrument_id uuid not null references public.instruments(id) on delete cascade,
  d date not null,
  close numeric not null,   -- in the instrument's own currency
  primary key (instrument_id, d)
);
-- Lookups by (instrument_id, d) are served by the primary key; no extra index needed.

-- 7. DIVIDENDS (history + upcoming) --------------------------
create table if not exists public.dividends (
  id uuid primary key default gen_random_uuid(),
  instrument_id uuid not null references public.instruments(id) on delete cascade,
  ex_date date,
  pay_date date,
  amount numeric,          -- per share
  currency text,
  unique (instrument_id, ex_date)
);

-- 7c. SPLITS (corporate actions) ------------------------------
-- Shared reference data, like dividends: the nightly sync writes it with the service role and
-- clients only read.
--
-- Splits are NOT applied by rewriting the user's transactions. Their ledger has to keep saying
-- what their broker statement says ("bought 10 @ $500"), or reconciliation breaks and the import
-- dedupe key stops matching, which would re-import every pre-split trade as a new row. Instead
-- the raw rows stay verbatim and the positions view scales them at query time — the same rule the
-- rest of the schema follows: transactions are the source of truth, everything else is computed.
create table if not exists public.instrument_splits (
  id uuid primary key default gen_random_uuid(),
  instrument_id uuid not null references public.instruments(id) on delete cascade,
  ex_date date not null,       -- first session that trades at the new share count
  ratio numeric not null,      -- 4 = 4-for-1 forward; 0.1 = 1-for-10 reverse
  source text not null default 'provider',  -- provider | manual
  created_at timestamptz not null default now(),
  unique (instrument_id, ex_date),
  -- A zero or negative ratio would multiply every historical share count into nonsense, so it is
  -- rejected at the table rather than defended against in each reader.
  constraint instrument_splits_ratio_positive check (ratio > 0)
);
create index if not exists instrument_splits_instrument_idx on public.instrument_splits(instrument_id);

-- Exact product aggregate. Two splits on one holding have to compose (a 2-for-1 then a 3-for-1 is
-- 6x), and Postgres has no built-in product. The obvious exp(sum(ln(x))) trick returns a float
-- with rounding dust — 4.000000000000001 shares is not a share count anyone should see — so this
-- multiplies numerics exactly instead.
-- search_path pinned empty: closes the Supabase security-advisor "function search_path mutable"
-- lint. Harmless here either way (a * b resolves through pg_catalog regardless), but cheap to fix.
-- The product() aggregate below can't take the same fix directly (Postgres rejects `alter function`
-- on an aggregate) — it's not independently exploitable since sfunc is bound to numeric_mul's OID
-- at creation time, not looked up by name per call, so pinning numeric_mul secures both.
create or replace function public.numeric_mul(a numeric, b numeric)
  returns numeric language sql immutable strict set search_path = '' as $$ select a * b $$;
drop aggregate if exists public.product(numeric) cascade;
create aggregate public.product(numeric) (
  sfunc = public.numeric_mul,
  stype = numeric,
  initcond = '1'
);

-- 7d. PORTFOLIO SPLITS (a user's own corrections) --------------
-- instrument_splits above is SHARED reference data. A user-entered split must never go in it: one
-- person recording a mistaken 10-for-1 would restate the cost basis of every other holder of that
-- ticker. User entries live here instead, scoped by portfolio and enforced by RLS.
--
-- These also OVERRIDE a provider row on the same ex-date, which is what makes the feature useful
-- beyond filling gaps: if a vendor reported the wrong ratio, entering the right one replaces it,
-- and entering a ratio of 1 cancels a split the vendor invented.
create table if not exists public.portfolio_splits (
  id uuid primary key default gen_random_uuid(),
  portfolio_id uuid not null references public.portfolios(id) on delete cascade,
  instrument_id uuid not null references public.instruments(id) on delete cascade,
  ex_date date not null,
  ratio numeric not null,   -- 4 = 4-for-1; 0.1 = 1-for-10 reverse; 1 = cancel a provider's row
  note text,
  created_at timestamptz not null default now(),
  unique (portfolio_id, instrument_id, ex_date),
  constraint portfolio_splits_ratio_positive check (ratio > 0)
);
create index if not exists portfolio_splits_lookup_idx
  on public.portfolio_splits(portfolio_id, instrument_id);

-- 7b. OPTION TRANSACTIONS (options-selling layer O1) ----------
-- Sold puts/calls, the wheel, rolls. Underlying = instrument_id.
-- Declared BEFORE the positions view because that view folds net
-- premium into equity cost basis. See docs/SPEC_options-selling.md.
create table if not exists public.option_transactions (
  id uuid primary key default gen_random_uuid(),
  portfolio_id uuid not null references public.portfolios(id) on delete cascade,
  instrument_id uuid not null references public.instruments(id),   -- the UNDERLYING
  action text not null,          -- sell_to_open | buy_to_close | expired | assigned | rolled
  option_type text not null,     -- put | call
  strike numeric not null,
  expiration date not null,
  contracts int not null default 1,     -- 1 contract = 100 shares
  premium numeric not null default 0,   -- per share, signed (+ received, - paid to close)
  fee numeric not null default 0,
  trade_date date not null default current_date,
  currency text not null default 'USD',
  roll_group_id uuid,                    -- links rolled / wheel legs (O2)
  linked_txn_id uuid references public.transactions(id) on delete set null,  -- assignment -> equity leg
  note text,
  dedupe_key text,
  created_at timestamptz not null default now()
);
create index if not exists opt_tx_portfolio_idx on public.option_transactions(portfolio_id);
create index if not exists opt_tx_instrument_idx on public.option_transactions(instrument_id);
create unique index if not exists option_transactions_dedupe_uidx
  on public.option_transactions(portfolio_id, dedupe_key);

-- ============================================================
-- POSITIONS view — computes Snowball-style holding fields
-- from transactions. Column names kept backward-compatible
-- (shares, avg_cost, last_price, day_change_pct) and extended.
-- Net option premium is exposed as its own option_premium column
-- and deliberately NOT folded into avg_cost/cost_basis/gain_value
-- (see the note on option_premium below — folding it in
-- double-counted the same dollars). The "premium lowers my cost"
-- framing lives only in the holding-detail display math.
-- ============================================================
drop view if exists public.positions cascade;
create view public.positions with (security_invoker = on) as
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
agg as (
  select
    t.portfolio_id,
    t.instrument_id,
    -- Share counts are restated in TODAY'S shares: a quantity recorded before a split is scaled by
    -- every split that has happened since. Money columns are deliberately NOT scaled — a split
    -- changes how many pieces you hold, never what you paid or what you were paid. So buy_value
    -- (quantity x price) and div_paid are split-invariant by construction, and avg_cost falls out
    -- correctly because only its denominator moves: pay $5,000 for 10 shares, then split 4-for-1,
    -- and you hold 40 shares at $125 with the same $5,000 basis.
    --
    -- The strict inequality on ex_date matters: a trade executed ON the ex-date already prices and
    -- counts in post-split shares, so only splits strictly AFTER a row apply to it.
    sum(case when t.type='buy' then t.quantity*sf.factor when t.type='sell' then -t.quantity*sf.factor else 0 end) as shares,
    sum(case when t.type='buy' then t.quantity*t.price + t.fees else 0 end)                     as buy_value,
    sum(case when t.type='buy' then t.quantity*sf.factor else 0 end)                            as buy_shares,
    sum(t.fees)                                                                                  as commission_paid,
    sum(case when t.type='dividend' then t.quantity*t.price else 0 end)                          as div_paid
  from public.transactions t
  left join lateral (
    -- The shared provider rows, plus this portfolio's own entries. A user row on the same ex-date
    -- REPLACES the provider's rather than compounding with it — two rows for one split would
    -- multiply the share count twice, which is a worse error than the gap it was added to fill.
    select public.product(s.ratio) as factor
    from (
      select g.ex_date, g.ratio
        from public.instrument_splits g
       where g.instrument_id = t.instrument_id
         and not exists (
           select 1 from public.portfolio_splits o
            where o.portfolio_id = t.portfolio_id
              and o.instrument_id = t.instrument_id
              and o.ex_date = g.ex_date
         )
      union all
      select o.ex_date, o.ratio
        from public.portfolio_splits o
       where o.portfolio_id = t.portfolio_id
         and o.instrument_id = t.instrument_id
    ) s
    where s.ex_date > t.executed_at
      -- Broker-reconciled rows are ALREADY in today's shares: the sync writes one opening-balance
      -- lot per held instrument to absorb transfers-in, pre-window shares and past splits, sized to
      -- the broker's current position. Adjusting it again would multiply a real holding by the
      -- split a second time. Twin of lib/brokersync/restated.ts.
      and coalesce(t.dedupe_key, '') not like 'ref:snaptrade-recon:%'
      and coalesce(t.dedupe_key, '') not like 'ref:snaptrade-pos:%'
  ) sf on true
  group by t.portfolio_id, t.instrument_id
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
  case when a.buy_shares > 0 then a.buy_value / a.buy_shares else 0 end as avg_cost,
  a.buy_value,
  a.commission_paid,
  a.div_paid,
  pc.price            as last_price,
  pc.change_pct       as day_change_pct,
  pc.as_of            as price_as_of,
  (pc.price * a.shares)                                                            as current_total_price,
  (case when a.buy_shares > 0 then a.buy_value / a.buy_shares else 0 end * a.shares) as cost_basis,
  (pc.price * a.shares) - (case when a.buy_shares > 0 then a.buy_value / a.buy_shares else 0 end * a.shares) as gain_value,
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
left join public.price_cache pc on pc.instrument_id = i.id
left join opt o on o.portfolio_id = a.portfolio_id and o.instrument_id = a.instrument_id
-- Exclude fully-closed positions. A round-tripped holding can net to floating-point dust
-- (e.g. 3e-15 shares) rather than exactly 0, which would otherwise show as a junk "0.0000 · $0"
-- row in the by-account view. 1e-9 is far below any real holding, including satoshi-level crypto.
where abs(a.shares) > 1e-9;

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

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================
alter table public.profiles     enable row level security;
alter table public.portfolios   enable row level security;
alter table public.categories   enable row level security;
alter table public.transactions enable row level security;
alter table public.option_transactions enable row level security;
alter table public.instruments  enable row level security;
alter table public.price_cache  enable row level security;
alter table public.price_history enable row level security;
alter table public.dividends    enable row level security;
alter table public.instrument_splits enable row level security;
alter table public.portfolio_splits enable row level security;

drop policy if exists "own profile" on public.profiles;
create policy "own profile" on public.profiles for all using (auth.uid() = id) with check (auth.uid() = id);

drop policy if exists "own portfolios" on public.portfolios;
create policy "own portfolios" on public.portfolios for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own categories" on public.categories;
create policy "own categories" on public.categories for all using (
  exists (select 1 from public.portfolios p where p.id = categories.portfolio_id and p.user_id = auth.uid())
) with check (
  exists (select 1 from public.portfolios p where p.id = categories.portfolio_id and p.user_id = auth.uid())
);

drop policy if exists "own transactions" on public.transactions;
create policy "own transactions" on public.transactions for all using (
  exists (select 1 from public.portfolios p where p.id = transactions.portfolio_id and p.user_id = auth.uid())
) with check (
  exists (select 1 from public.portfolios p where p.id = transactions.portfolio_id and p.user_id = auth.uid())
);

drop policy if exists "own portfolio_splits" on public.portfolio_splits;
create policy "own portfolio_splits" on public.portfolio_splits for all using (
  exists (select 1 from public.portfolios p where p.id = portfolio_splits.portfolio_id and p.user_id = auth.uid())
) with check (
  exists (select 1 from public.portfolios p where p.id = portfolio_splits.portfolio_id and p.user_id = auth.uid())
);

drop policy if exists "own option_transactions" on public.option_transactions;
create policy "own option_transactions" on public.option_transactions for all using (
  exists (select 1 from public.portfolios p where p.id = option_transactions.portfolio_id and p.user_id = auth.uid())
) with check (
  exists (select 1 from public.portfolios p where p.id = option_transactions.portfolio_id and p.user_id = auth.uid())
);

-- Shared reference data: read-only to clients; writes via service role.
-- Instruments are scoped to the ones a user actually references (via their own transactions or
-- option legs), so a signed-in user can't enumerate the full universe of tickers/names/sectors that
-- OTHER users have added. The security_invoker positions/option_positions views join instruments
-- only on the user's own instrument_ids, so this policy leaves them intact. Public benchmark lookups
-- (e.g. SPY on the performance page) use the service-role client instead of relying on this policy.
drop policy if exists "read instruments" on public.instruments;
drop policy if exists "read own instruments" on public.instruments;
create policy "read own instruments" on public.instruments for select using (
  exists (
    select 1 from public.transactions t
    join public.portfolios p on p.id = t.portfolio_id
    where t.instrument_id = instruments.id and p.user_id = auth.uid()
  )
  or exists (
    select 1 from public.option_transactions ot
    join public.portfolios p on p.id = ot.portfolio_id
    where ot.instrument_id = instruments.id and p.user_id = auth.uid()
  )
);
drop policy if exists "read prices" on public.price_cache;
create policy "read prices" on public.price_cache for select using (auth.role() = 'authenticated');
drop policy if exists "read price_history" on public.price_history;
create policy "read price_history" on public.price_history for select using (auth.role() = 'authenticated');

-- Cached FX (usd_rate = value of 1 unit of `quote` in USD), refreshed by the nightly sync so pages
-- never call a live FX provider at render time. Authenticated read only; service role writes.
create table if not exists public.fx_rates (
  quote text primary key,
  usd_rate numeric not null,
  as_of timestamptz not null default now()
);
alter table public.fx_rates enable row level security;
drop policy if exists "read fx_rates" on public.fx_rates;
create policy "read fx_rates" on public.fx_rates for select using (auth.role() = 'authenticated');
drop policy if exists "read dividends" on public.dividends;
create policy "read dividends" on public.dividends for select using (auth.role() = 'authenticated');
drop policy if exists "read instrument_splits" on public.instrument_splits;
create policy "read instrument_splits" on public.instrument_splits for select using (auth.role() = 'authenticated');

-- ============================================================
-- 8. BROKER SYNC (SnapTrade) — see docs/SPEC_broker-sync.md
-- ============================================================
create table if not exists public.broker_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null default 'snaptrade',
  provider_user_id text not null,
  provider_user_secret text not null,      -- SECRET: service-role only (RLS on, no client policies)
  created_at timestamptz not null default now(),
  unique (user_id, provider)
);

create table if not exists public.broker_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null default 'snaptrade',
  provider_account_id text not null,
  brokerage_name text,
  account_number text,
  portfolio_id uuid references public.portfolios(id) on delete set null,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, provider, provider_account_id)
);

alter table public.broker_connections enable row level security;
alter table public.broker_accounts    enable row level security;

-- broker_connections holds a secret: RLS on with NO policies -> only the service role can touch it.
-- broker_accounts has no secrets: the owner may read (list) their connected accounts; writes via service role.
drop policy if exists "own broker_accounts read" on public.broker_accounts;
create policy "own broker_accounts read" on public.broker_accounts for select using (auth.uid() = user_id);

-- Balance/category capture (so cash/deposit accounts like Chase route to the cash ledger).
alter table public.broker_accounts add column if not exists account_category text;
alter table public.broker_accounts add column if not exists account_type text;
alter table public.broker_accounts add column if not exists cash_balance numeric;
alter table public.broker_accounts add column if not exists currency text;
alter table public.broker_accounts add column if not exists is_cash boolean not null default false;
alter table public.broker_accounts add column if not exists raw jsonb;

-- ============================================================
-- 9. CASH LEDGER — manual cash movements (deposits/withdrawals/interest/fees).
-- Synced balances live on broker_accounts.cash_balance; this is the manual overlay.
-- ============================================================
create table if not exists public.cash_ledger (
  id uuid primary key default gen_random_uuid(),
  portfolio_id uuid not null references public.portfolios(id) on delete cascade,
  entry_date date not null default current_date,
  description text,
  amount numeric not null default 0,       -- signed: + in, - out
  currency text not null default 'USD',
  source text not null default 'manual',   -- manual | synced
  dedupe_key text,
  created_at timestamptz not null default now()
);
create index if not exists cash_ledger_portfolio_idx on public.cash_ledger(portfolio_id);
create unique index if not exists cash_ledger_dedupe_uidx on public.cash_ledger(portfolio_id, dedupe_key);

alter table public.cash_ledger enable row level security;
drop policy if exists "own cash_ledger" on public.cash_ledger;
create policy "own cash_ledger" on public.cash_ledger for all using (
  exists (select 1 from public.portfolios p where p.id = cash_ledger.portfolio_id and p.user_id = auth.uid())
) with check (
  exists (select 1 from public.portfolios p where p.id = cash_ledger.portfolio_id and p.user_id = auth.uid())
);

-- Immutable daily value record per account (base currency), written by the nightly sync + on manual
-- sync for EVERY account, so a drift-proof value-over-time history accumulates going forward.
create table if not exists public.portfolio_value_history (
  portfolio_id uuid not null references public.portfolios(id) on delete cascade,
  d date not null,
  market_value numeric not null,   -- holdings market value, base currency
  cost_basis numeric,              -- cost basis, base currency
  currency text not null default 'USD',
  created_at timestamptz not null default now(),
  primary key (portfolio_id, d)
);

alter table public.portfolio_value_history enable row level security;
drop policy if exists "read own portfolio value history" on public.portfolio_value_history;
create policy "read own portfolio value history" on public.portfolio_value_history for select using (
  exists (select 1 from public.portfolios p where p.id = portfolio_value_history.portfolio_id and p.user_id = auth.uid())
);

-- ============================================================
-- 10. NOTIFICATIONS — options alerts + weekly income digest
-- ============================================================
-- Per-user email preferences (opt-in; off by default).
create table if not exists public.notification_prefs (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email_alerts boolean not null default false,   -- assignment/expiry/ex-dividend alerts
  email_digest boolean not null default false,   -- weekly income digest
  updated_at timestamptz not null default now()
);
alter table public.notification_prefs enable row level security;
drop policy if exists "own notification_prefs" on public.notification_prefs;
create policy "own notification_prefs" on public.notification_prefs for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Idempotency log so a daily alert cron never emails the same event twice.
-- Service-role only (RLS on, no client policies).
create table if not exists public.sent_notifications (
  user_id uuid not null references auth.users(id) on delete cascade,
  dedupe_key text not null,
  sent_at timestamptz not null default now(),
  primary key (user_id, dedupe_key)
);
alter table public.sent_notifications enable row level security;

-- ============================================================
-- 11. IV HISTORY — trailing implied-volatility samples for IV Rank (O3 finder)
-- ============================================================
-- One IV reading per symbol per day, captured on each put-finder scan (and nightly). We rank
-- today's IV against this trailing range. Keyed by symbol/exchange (not instrument_id) so we can
-- sample names the user doesn't hold yet. Shared reference data: service-role writes, authed reads.
create table if not exists public.iv_history (
  symbol text not null,
  exchange text not null default 'US',
  captured_on date not null,
  iv numeric not null,                       -- implied volatility, percent (e.g. 32.4)
  created_at timestamptz not null default now(),
  primary key (symbol, exchange, captured_on)
);
-- Reads filter (symbol, exchange, captured_on >= window) — fully served by the primary key.

alter table public.iv_history enable row level security;
drop policy if exists "read iv_history" on public.iv_history;
create policy "read iv_history" on public.iv_history for select using (auth.role() = 'authenticated');

-- ============================================================
-- 12. SYNC RUNS — one row per cron invocation (observability)
-- ============================================================
-- The crons already build rich JSON summaries that Vercel discards; this records them so a dead
-- cron, a partial sync, or provider throttling is visible the next morning instead of never.
-- Service-role only (RLS on, no client policies). App code writes best-effort: a missing table
-- (migration not applied yet) must never fail a cron run.
create table if not exists public.sync_runs (
  id uuid primary key default gen_random_uuid(),
  job text not null,               -- sync | alerts | digest | backfill
  started_at timestamptz not null,
  duration_ms int,
  summary jsonb,                   -- the route's own JSON result, incl. provider-call counts
  failed_symbols text[],           -- which instruments errored (empty = clean run)
  created_at timestamptz not null default now()
);
create index if not exists sync_runs_job_idx on public.sync_runs(job, created_at desc);
alter table public.sync_runs enable row level security;

-- ============================================================
-- 13. FINDER SCANS — shared put-finder result cache
-- ============================================================
-- One row per (scan-parameter) key with the full FinderResult JSON. Scans are informational, not
-- live trading data, so a short TTL (enforced in code, ~10 min) is acceptable — and it bounds the
-- provider fan-out to ~one full scan per TTL globally instead of per user per click.
-- Service-role only (RLS on, no client policies); reads/writes are best-effort in code.
create table if not exists public.finder_scans (
  scan_key text primary key,       -- hash of (targetDte, otmPct, universe)
  result jsonb not null,
  created_at timestamptz not null default now()
);
alter table public.finder_scans enable row level security;
