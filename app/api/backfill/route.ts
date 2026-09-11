import { createAdminClient } from "@/lib/supabase/admin";
import { syncInstrumentPriceHistory } from "@/lib/marketdata/sync";
import { fetchAll } from "@/lib/supabase/paginate";
import { recordSyncRun, isCronAuthorized } from "@/lib/cron";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// One-time deep backfill of weekly closing-price history, so the Performance chart can reach back to
// a portfolio's inception instead of just the nightly ~13-month window. Fetches ~7 years of weekly
// closes for EVERY instrument that appears in the ledger (held or since-exited — the value-over-time
// line values positions you held at each past date). Idempotent: re-running only fills gaps.
//
// Auth: the CRON_SECRET bearer only. It used to also accept a signed-in owner's cookie, which made
// it a side-effecting GET reachable from any page the owner happened to be looking at (a hostile
// link sends the SameSite=Lax cookie and triggers thousands of provider calls). The signed-in path
// still exists — app/dashboard/performance/actions.ts backfillHistory is a Server Action with the
// origin check that brings — so nothing was lost by closing this one.
export async function GET(request: Request) {
  if (!isCronAuthorized(request)) return new Response("Unauthorized", { status: 401 });
  const startedAt = Date.now();

  const url = new URL(request.url);
  // ~7 years back by default (covers a 2020 inception); overridable via ?days=.
  const fromDays = Math.min(Math.max(Number(url.searchParams.get("days")) || 2600, 400), 4000);

  const admin = createAdminClient();

  // Every instrument that appears in the transaction ledger — including fully-exited positions, whose
  // past value still belongs on the historical line. Cross-user with the service role, so page past
  // the ~1000-row cap: the previous unpaginated read silently skipped every instrument beyond it.
  type Inst = { symbol: string; exchange: string; type: string | null; currency: string | null };
  type Row = { instrument_id: string; instruments: Inst | Inst[] | null };
  const txInsts = await fetchAll<Row>((from, to) =>
    admin
      .from("transactions")
      .select("instrument_id, instruments(symbol, exchange, type, currency)")
      .order("instrument_id", { ascending: true })
      .order("id", { ascending: true })
      .range(from, to),
  );

  const byId = new Map<string, { id: string; symbol: string; exchange: string; type: string | null; currency: string | null }>();
  for (const r of txInsts) {
    const inst = Array.isArray(r.instruments) ? r.instruments[0] ?? null : r.instruments;
    if (!inst || !r.instrument_id || byId.has(r.instrument_id)) continue;
    byId.set(r.instrument_id, { id: r.instrument_id, symbol: inst.symbol, exchange: inst.exchange, type: inst.type, currency: inst.currency });
  }
  // Crypto weekly history isn't reliably available via the equity price feed and is a negligible
  // slice — skip it here (current value still shows on the dashboard).
  const instruments = [...byId.values()].filter((i) => (i.type ?? "") !== "crypto");

  let ok = 0;
  let failed = 0;
  const BATCH = 6;
  for (let i = 0; i < instruments.length; i += BATCH) {
    await Promise.all(
      instruments.slice(i, i + BATCH).map(async (inst) => {
        try {
          await syncInstrumentPriceHistory(admin, inst.id, inst.symbol, inst.exchange, fromDays, inst.currency);
          ok++;
        } catch {
          failed++;
        }
      })
    );
  }

  const summary = { backfilled: ok, failed, total: instruments.length, fromDays };
  await recordSyncRun(admin, "backfill", startedAt, summary);
  return Response.json(summary);
}
