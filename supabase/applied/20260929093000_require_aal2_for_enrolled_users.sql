-- Applied to production 2026-09-29. Mirrors the "2FA AT THE DATA LAYER" section of schema.sql.
-- No user had a verified factor when it went live, so nobody's access changed that day.
-- ============================================================
-- 2FA AT THE DATA LAYER — an enrolled user's data needs an aal2 session
-- ============================================================
-- The app's own pages and routes check the second factor in proxy.ts, but the Data API is reachable
-- directly with the public URL and anon key: a password sign-in returns a normal aal1 token that
-- every auth.uid() policy above accepts. For anyone with a verified factor, this restrictive policy
-- (ANDed with the others) makes their rows invisible and unwritable until the session is aal2.
-- Users without 2FA are unaffected. Blocking the base tables also empties the security_invoker
-- views. The helper is SECURITY DEFINER because `authenticated` can't read auth.mfa_factors, and
-- it lives in a schema the Data API doesn't expose.
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

create or replace function private.mfa_satisfied()
  returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(auth.jwt()->>'aal', '') = 'aal2'
      or not exists (select 1 from auth.mfa_factors f where f.user_id = auth.uid() and f.status = 'verified')
$$;
revoke all on function private.mfa_satisfied() from public, anon;
grant execute on function private.mfa_satisfied() to authenticated;

do $$
declare t text;
begin
  foreach t in array array['profiles', 'consent_log', 'portfolios', 'categories', 'transactions',
    'option_transactions', 'portfolio_splits', 'cash_ledger', 'portfolio_value_history',
    'broker_accounts', 'notification_prefs'] loop
    execute format('drop policy if exists "require mfa when enrolled" on public.%I', t);
    execute format('create policy "require mfa when enrolled" on public.%I as restrictive for all to authenticated using ((select private.mfa_satisfied())) with check ((select private.mfa_satisfied()))', t);
  end loop;
end $$;
