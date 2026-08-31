// Loading splits for a set of instruments.
//
// Every page that turns transactions into share counts or per-share money needs the same lookup,
// so it lives in one place rather than being re-derived (slightly differently) four times.

import { createClient } from "@/lib/supabase/server";
import { fetchAll } from "@/lib/supabase/paginate";
import { groupSplitsByInstrument, type Split } from "./splits";

type SupabaseClient = Awaited<ReturnType<typeof createClient>>;

type SplitRow = { instrument_id: string; ex_date: string | null; ratio: number | null };

/**
 * Splits for the given instruments, keyed by instrument id and ascending by date.
 *
 * Returns an empty map for an empty input rather than querying for nothing — `in()` with an empty
 * list is a wasted round trip on every page load for a brand-new account.
 */
export async function loadSplitsByInstrument(
  supabase: SupabaseClient,
  instrumentIds: string[]
): Promise<Map<string, Split[]>> {
  const ids = [...new Set(instrumentIds.filter(Boolean))];
  if (!ids.length) return new Map();
  const rows = await fetchAll<SplitRow>((from, to) =>
    supabase
      .from("instrument_splits")
      .select("instrument_id, ex_date, ratio")
      .in("instrument_id", ids)
      .order("ex_date", { ascending: true })
      .order("instrument_id", { ascending: true })
      .range(from, to),
  );
  return groupSplitsByInstrument(rows);
}
