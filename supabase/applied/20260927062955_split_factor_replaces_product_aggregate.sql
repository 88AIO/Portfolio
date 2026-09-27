-- Split factor: the exact product of the split ratios that apply to one trade. Two splits on one
-- holding compose (a 2-for-1 then a 3-for-1 is 6x), and the obvious exp(sum(ln(x))) returns a float
-- with rounding dust (4.000000000000001 shares), so this multiplies numerics exactly. It replaces a
-- custom product() aggregate: an aggregate can't carry a pinned search_path, which kept the
-- Supabase security advisor's "function search_path mutable" warning permanently lit. Same result:
-- nulls are skipped and no splits at all is a factor of 1.
create or replace function public.split_factor(ratios numeric[])
  returns numeric language plpgsql immutable set search_path = '' as $$
declare
  f numeric := 1;
  r numeric;
begin
  foreach r in array coalesce(ratios, '{}'::numeric[]) loop
    if r is not null then f := f * r; end if;
  end loop;
  return f;
end $$;

-- Swap the live view onto it without restating the view: the definition is read back from the
-- database, so nothing but this one call can change. security_invoker is restated because
-- CREATE OR REPLACE VIEW resets view options, and without it the view would read every user's rows.
do $$
declare
  def text := pg_get_viewdef('public.positions_all'::regclass);
  swapped text := replace(def, 'product(s.ratio)', 'split_factor(array_agg(s.ratio))');
begin
  if swapped = def then
    raise exception 'positions_all no longer calls product(s.ratio); refusing to guess';
  end if;
  execute 'create or replace view public.positions_all with (security_invoker = on) as ' || swapped;
end $$;

drop aggregate public.product(numeric);
drop function public.numeric_mul(numeric, numeric);
