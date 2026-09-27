-- ============================================================
-- 14. RATE LIMITS — per-user caps on server actions that cost something
-- ============================================================
-- Adding a holding, importing a file, refreshing prices, scanning the put finder and checking
-- splits all call the market-data provider; the test email sends mail from our domain. The shared
-- caches bound most of that, but a signed-in script calling a server action in a loop could still
-- exhaust the free provider feed every user depends on. One row per (user, action): a fixed window
-- that resets once it has elapsed.
--
-- Only the service role may count. If the function took the caller's own parameters through
-- PostgREST, a user could call it with a one-second window to reset their counter between
-- requests; so server actions call it with the admin client and the user id they already verified.
create table if not exists public.rate_limits (
  user_id uuid not null references auth.users(id) on delete cascade,
  bucket text not null,
  window_start timestamptz not null default now(),
  hits int not null default 0,
  primary key (user_id, bucket)
);
alter table public.rate_limits enable row level security;
revoke all on public.rate_limits from anon, authenticated;

create or replace function public.hit_rate_limit(p_user uuid, p_bucket text, p_limit int, p_window_seconds int)
  returns boolean language sql volatile set search_path = '' as $$
  insert into public.rate_limits as r (user_id, bucket, window_start, hits)
  values (p_user, p_bucket, now(), 1)
  on conflict (user_id, bucket) do update set
    hits = case when r.window_start <= now() - make_interval(secs => p_window_seconds) then 1 else r.hits + 1 end,
    window_start = case when r.window_start <= now() - make_interval(secs => p_window_seconds) then now() else r.window_start end
  returning hits <= p_limit
$$;
revoke all on function public.hit_rate_limit(uuid, text, int, int) from public, anon, authenticated;
grant execute on function public.hit_rate_limit(uuid, text, int, int) to service_role;

-- Service-role-only tables say so explicitly. RLS with no policy already denies every client; the
-- explicit deny documents the intent where the next reader looks (and clears the advisor's
-- "RLS enabled, no policy" notice, which cannot tell intent from omission).
do $$
declare t text;
begin
  foreach t in array array['broker_connections', 'sent_notifications', 'sync_runs', 'finder_scans', 'rate_limits'] loop
    execute format('drop policy if exists "service role only" on public.%I', t);
    execute format('create policy "service role only" on public.%I for all to anon, authenticated using (false) with check (false)', t);
  end loop;
end $$;
