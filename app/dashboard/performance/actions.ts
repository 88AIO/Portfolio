"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { syncInstrumentPriceHistory } from "@/lib/marketdata/sync";
import { isBrokerSyncOwner } from "@/lib/brokersync";

type Row = {
  instrument_id: string;
  instruments: { symbol: string; exchange: string; type: string | null } | null;
};

// One-time deep backfill of weekly closing-price history, so the value-over-time chart reaches back
// to a portfolio's inception instead of only the nightly ~13-month window. Runs as a Server Action
// (from the signed-in Performance page) so it uses the owner's session directly — no cross-domain
// URL / secret needed. Idempotent: re-running only fills gaps.
export async function backfillHistory(): Promise<{ ok: boolean; message: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!isBrokerSyncOwner(user?.email)) {
    return { ok: false, message: "Only the account owner can run the history backfill." };
  }

  const admin = createAdminClient();
  const { data: txInsts, error } = await admin
    .from("transactions")
    .select("instrument_id, instruments(symbol, exchange, type)");
  if (error) return { ok: false, message: `Couldn't read holdings: ${error.message}` };

  // Every instrument in the ledger (held or since-exited — the historical line values positions you
  // held at each past date). Dedupe to one entry per instrument; skip crypto (no reliable weekly feed).
  const byId = new Map<string, { id: string; symbol: string; exchange: string }>();
  for (const r of (txInsts ?? []) as unknown as Row[]) {
    const inst = r.instruments;
    if (!inst || !r.instrument_id || byId.has(r.instrument_id)) continue;
    if ((inst.type ?? "") === "crypto") continue;
    byId.set(r.instrument_id, { id: r.instrument_id, symbol: inst.symbol, exchange: inst.exchange });
  }
  const instruments = [...byId.values()];

  let ok = 0;
  let failed = 0;
  const BATCH = 6;
  for (let i = 0; i < instruments.length; i += BATCH) {
    await Promise.all(
      instruments.slice(i, i + BATCH).map(async (inst) => {
        try {
          await syncInstrumentPriceHistory(admin, inst.id, inst.symbol, inst.exchange, 2600); // ~7 years
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
