import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { syncInstrumentPriceHistory } from "@/lib/marketdata/sync";
import { isBrokerSyncOwner } from "@/lib/brokersync";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// One-time deep backfill of weekly closing-price history, so the Performance chart can reach back to
// a portfolio's inception instead of just the nightly ~13-month window. Fetches ~7 years of weekly
// closes for EVERY instrument that appears in the ledger (held or since-exited — the value-over-time
// line values positions you held at each past date). Idempotent: re-running only fills gaps.
//
// Auth: the CRON_SECRET bearer (automated), OR a signed-in owner (so it can be triggered from the
// browser without exposing the secret). Owner-gated because it fans out many provider calls.
async function authorize(request: Request): Promise<boolean> {
  const secret = process.env.CRON_SECRET;
  if (secret && request.headers.get("authorization") === `Bearer ${secret}`) return true;
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    return isBrokerSyncOwner(user?.email);
  } catch {
    return false;
  }
}

export async function GET(request: Request) {
  if (!(await authorize(request))) return new Response("Unauthorized", { status: 401 });

  const url = new URL(request.url);
  // ~7 years back by default (covers a 2020 inception); overridable via ?days=.
  const fromDays = Math.min(Math.max(Number(url.searchParams.get("days")) || 2600, 400), 4000);

  const admin = createAdminClient();

  // Every instrument that appears in the transaction ledger — including fully-exited positions, whose
  // past value still belongs on the historical line. Join to instruments for the symbol/exchange.
  const { data: txInsts, error } = await admin
    .from("transactions")
    .select("instrument_id, instruments(symbol, exchange, type)");
  if (error) return new Response(error.message, { status: 500 });

  type Row = { instrument_id: string; instruments: { symbol: string; exchange: string; type: string | null } | null };
  const byId = new Map<string, { id: string; symbol: string; exchange: string; type: string | null }>();
  for (const r of (txInsts ?? []) as unknown as Row[]) {
    const inst = r.instruments;
    if (!inst || !r.instrument_id || byId.has(r.instrument_id)) continue;
    byId.set(r.instrument_id, { id: r.instrument_id, symbol: inst.symbol, exchange: inst.exchange, type: inst.type });
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
          await syncInstrumentPriceHistory(admin, inst.id, inst.symbol, inst.exchange, fromDays);
          ok++;
        } catch {
          failed++;
        }
      })
    );
  }

  return Response.json({ backfilled: ok, failed, total: instruments.length, fromDays });
}
