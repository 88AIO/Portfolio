"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { syncInstrumentPriceHistory } from "@/lib/marketdata/sync";
import { isBrokerSyncOwner } from "@/lib/brokersync";
import { fetchAll } from "@/lib/supabase/paginate";

type Inst = { symbol: string; exchange: string; type: string | null; currency: string | null };
type Row = {
  instrument_id: string;
  instruments: Inst | Inst[] | null;
};

// One-time deep backfill of weekly closing-price history, so the value-over-time chart reaches back
// to a portfolio's inception instead of only the nightly ~13-month window. Runs as a Server Action
// (from the signed-in Performance page) so it uses the owner's session directly — no cross-domain
// URL / secret needed. Idempotent: re-running only fills gaps.
export async function backfillHistory(): Promise<{ ok: boolean; message: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.email_confirmed_at || !isBrokerSyncOwner(user.email)) {
    return { ok: false, message: "Only the account owner can run the history backfill." };
  }

  const admin = createAdminClient();
  // Cross-user with the service role: page past the ~1000-row cap, or instruments beyond it are
  // silently never backfilled.
  let txInsts: Row[];
  try {
    txInsts = await fetchAll<Row>((from, to) =>
      admin
        .from("transactions")
        .select("instrument_id, instruments(symbol, exchange, type, currency)")
        .order("instrument_id", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to),
    );
  } catch (e) {
    return { ok: false, message: `Couldn't read holdings: ${e instanceof Error ? e.message : String(e)}` };
  }

  // Every instrument in the ledger (held or since-exited — the historical line values positions you
  // held at each past date). Dedupe to one entry per instrument; skip crypto (no reliable weekly feed).
  const byId = new Map<string, { id: string; symbol: string; exchange: string; currency: string | null }>();
  for (const r of txInsts) {
    const inst = Array.isArray(r.instruments) ? r.instruments[0] ?? null : r.instruments;
    if (!inst || !r.instrument_id || byId.has(r.instrument_id)) continue;
    if ((inst.type ?? "") === "crypto") continue;
    byId.set(r.instrument_id, { id: r.instrument_id, symbol: inst.symbol, exchange: inst.exchange, currency: inst.currency });
  }
  const instruments = [...byId.values()];

  let ok = 0;
  let failed = 0;
  const BATCH = 6;
  for (let i = 0; i < instruments.length; i += BATCH) {
    await Promise.all(
      instruments.slice(i, i + BATCH).map(async (inst) => {
        try {
          await syncInstrumentPriceHistory(admin, inst.id, inst.symbol, inst.exchange, 2600, inst.currency); // ~7 years
          ok++;
        } catch {
          failed++;
        }
      })
    );
  }

  revalidatePath("/dashboard/performance");
  const failNote = failed ? ` (${failed} not covered by the price feed — usually a delisted ticker)` : "";
  return { ok: true, message: `Backfilled price history for ${ok} of ${instruments.length} holdings, back to ~2020${failNote}. Refresh to see the full chart.` };
}
