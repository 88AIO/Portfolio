// Loading splits for a set of instruments.
//
// Two sources, deliberately kept apart:
//   • instrument_splits  — shared reference data written by the nightly sync from the provider.
//   • portfolio_splits   — the user's own entries, RLS-scoped to their portfolios.
//
// A user row REPLACES a provider row on the same ex-date rather than compounding with it. Two rows
// for one split would scale the share count twice, which is a worse error than the missing split it
// was entered to fix. That override is also what lets someone correct a wrong ratio, or cancel a
// split the vendor invented, by entering a ratio of 1.
//
// The SQL twin of this merge lives in the positions view in supabase/schema.sql — change both.

import { createClient } from "@/lib/supabase/server";
import { fetchAll } from "@/lib/supabase/paginate";
import {
  groupSplitsByInstrument,
  mergeSplits,
  type Split,
  type SplitRecord,
  type GlobalSplitRow,
  type OwnSplitRow,
} from "./splits";

type SupabaseClient = Awaited<ReturnType<typeof createClient>>;

/**
 * The merged splits, each keeping its provenance so the UI can say which rows came from the data
 * provider and which the user entered — and therefore which ones they are allowed to remove.
 */
export async function loadSplitRecords(
  supabase: SupabaseClient,
  instrumentIds: string[]
): Promise<Map<string, SplitRecord[]>> {
  const ids = [...new Set(instrumentIds.filter(Boolean))];
  if (!ids.length) return new Map();

  const [globals, own] = await Promise.all([
    fetchAll<GlobalSplitRow>((from, to) =>
      supabase
        .from("instrument_splits")
        .select("instrument_id, ex_date, ratio")
        .in("instrument_id", ids)
        .order("ex_date", { ascending: true })
        .order("instrument_id", { ascending: true })
        .range(from, to),
    ),
    // No portfolio filter: RLS already scopes this to the signed-in user, and the pages that read
    // it consolidate across all of their portfolios.
    fetchAll<OwnSplitRow>((from, to) =>
      supabase
        .from("portfolio_splits")
        .select("id, instrument_id, ex_date, ratio, note, created_at")
        .in("instrument_id", ids)
        .order("ex_date", { ascending: true })
        .order("instrument_id", { ascending: true })
        .range(from, to),
    ),
  ]);
  return mergeSplits(globals, own);
}

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
  const detailed = await loadSplitRecords(supabase, instrumentIds);
  const out = new Map<string, Split[]>();
  for (const [id, records] of detailed) {
    out.set(id, records.map(({ exDate, ratio }) => ({ exDate, ratio })));
  }
  return out;
}

export { groupSplitsByInstrument, mergeSplits };
export type { SplitRecord };
