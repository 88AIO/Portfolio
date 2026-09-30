-- Asian stocks' old weekly rows sat on the Sunday BEFORE the week whose close they carry.
--
-- Yahoo stamped each weekly bar at Monday 00:00 exchange time. For Hong Kong, Singapore, Kuala
-- Lumpur, Taipei and Shanghai (UTC+8) that instant is Sunday 16:00 UTC, so the rows were saved
-- under the Sunday — five days before the Friday close they hold, and inside the previous ISO week.
-- Verified before running: every one of the 16 Sunday rows that already had a Friday twin (d + 5)
-- carried exactly that Friday's close. The 2026-09-27 repair only moved Monday stamps. The nightly
-- sync now writes daily-derived closes on their real dates, but it only rewrites the last ~400 days
-- of held instruments, so these older rows (3,933, 2019-07 to 2026-08) had to be moved here.
--
-- Crypto is excluded: its week really does end on Sunday.

-- 1. Sunday stamps whose Friday twin already exists: identical close, drop the stamp.
delete from public.price_history p
using public.instruments i
where i.id = p.instrument_id
  and i.type <> 'crypto'
  and extract(isodow from p.d) = 7
  and exists (select 1 from public.price_history q where q.instrument_id = p.instrument_id and q.d = p.d + 5);

-- 2. The rest move to the Friday they belong to.
update public.price_history p
set d = p.d + 5
from public.instruments i
where i.id = p.instrument_id
  and i.type <> 'crypto'
  and extract(isodow from p.d) = 7;
