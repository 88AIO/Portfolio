-- Weekly closes on their real dates (data repair; see lib/marketdata/weekly.ts).
--
-- The provider's weekly bars are stamped with the week's Monday but carry the week's final close,
-- so every "close on or before" lookup inside a week read a price from up to four trading days
-- later (the S&P 500 benchmark bought SPY at Friday's price for a Monday trade). And the extra
-- daily rows the sync saved at 06:00 UTC for Asian exchanges and crypto were intraday prices,
-- not closes. This moves each completed week's true close (the Monday-stamped bar) onto the
-- week's last day — Friday, or Sunday for crypto — overwriting the intraday row there if one
-- exists, then keeps one row per completed week. The in-progress week is left for the sync.
create temp table wk on commit drop as
  select h.instrument_id, h.d, h.close, h.d + case when i.exchange = 'CRYPTO' then 6 else 4 end as d_end
  from public.price_history h join public.instruments i on i.id = h.instrument_id
  where extract(isodow from h.d) = 1;
delete from wk where d_end >= current_date;

update public.price_history x set close = w.close
  from wk w where x.instrument_id = w.instrument_id and x.d = w.d_end;
delete from public.price_history x using wk w
  where x.instrument_id = w.instrument_id and x.d = w.d
    and exists (select 1 from public.price_history y where y.instrument_id = w.instrument_id and y.d = w.d_end);
update public.price_history x set d = w.d_end
  from wk w where x.instrument_id = w.instrument_id and x.d = w.d;

delete from public.price_history x
  using (select instrument_id, d, max(d) over (partition by instrument_id, date_trunc('week', d)) as wk_last,
                date_trunc('week', d)::date as wk
           from public.price_history) t
  where x.instrument_id = t.instrument_id and x.d = t.d and t.d < t.wk_last and t.wk + 7 <= current_date;
