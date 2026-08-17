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
create index if not exists tx_portfolio_idx on public.transactions(portfolio_id);
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

-- ============================================================
-- POSITIONS view — computes Snowball-style holding fields
-- from transactions. Column names kept backward-compatible
-- (shares, avg_cost, last_price, day_change_pct) and extended.
-- ============================================================
drop view if exists public.positions;
create view public.positions with (security_invoker = on) as
with agg as (
  select
    t.portfolio_id,
    t.instrument_id,
    sum(case when t.type='buy' then t.quantity when t.type='sell' then -t.quantity else 0 end) as shares,
    sum(case when t.type='buy' then t.quantity*t.price + t.fees else 0 end)                     as buy_value,
    sum(case when t.type='buy' then t.quantity else 0 end)                                       as buy_shares,
    sum(t.fees)                                                                                  as commission_paid,
    sum(case when t.type='dividend' then t.quantity*t.price else 0 end)                          as div_paid
  from public.transactions t
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
  i.country_iso,
  i.logo_url,
  i.div_rating,
  a.shares,
  case when a.buy_shares > 0 then a.buy_value / a.buy_shares else 0 end            as avg_cost,
  a.buy_value,
  a.commission_paid,
  a.div_paid,
  pc.price            as last_price,
  pc.change_pct       as day_change_pct,
  pc.as_of            as price_as_of,
  (pc.price * a.shares)                                                            as current_total_price,
  (case when a.buy_shares > 0 then a.buy_value/a.buy_shares else 0 end * a.shares) as cost_basis,
  (pc.price * a.shares) - (case when a.buy_shares>0 then a.buy_value/a.buy_shares else 0 end * a.shares) as gain_value,
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
where a.shares <> 0;

-- PORTFOLIO TOTALS view --------------------------------------
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
-- ROW LEVEL SECURITY
-- ============================================================
alter table public.profiles     enable row level security;
alter table public.portfolios   enable row level security;
alter table public.categories   enable row level security;
alter table public.transactions enable row level security;
alter table public.instruments  enable row level security;
alter table public.price_cache  enable row level security;
alter table public.dividends    enable row level security;

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

-- Shared reference data: read-only to clients; writes via service role.
drop policy if exists "read instruments" on public.instruments;
create policy "read instruments" on public.instruments for select using (auth.role() = 'authenticated');
drop policy if exists "read prices" on public.price_cache;
create policy "read prices" on public.price_cache for select using (auth.role() = 'authenticated');
drop policy if exists "read dividends" on public.dividends;
create policy "read dividends" on public.dividends for select using (auth.role() = 'authenticated');

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
