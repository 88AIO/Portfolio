-- The column held the provider's whole account object, including the full account number the
-- row otherwise truncates to four digits, in a client-readable table. Nothing ever read it, the
-- sync stopped writing it on 2026-09-11, and every stored payload was cleared then. Drop it.
alter table public.broker_accounts drop column if exists raw;
