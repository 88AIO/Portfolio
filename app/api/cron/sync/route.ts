import { createAdminClient } from "@/lib/supabase/admin";
import {
  syncInstrumentQuote,
  syncInstrumentDividends,
  syncInstrumentPriceHistory,
} from "@/lib/marketdata/sync";
import { enrichInstrumentProfile } from "@/lib/enrich";
import { searchInstrument } from "@/lib/marketdata";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Nightly market-data sync (Vercel Cron). Does the heavy provider work the user-facing "Refresh
// prices" deliberately skips: fresh quotes, dividend history, weekly price history, and
// sector/name enrichment — for every instrument any user holds. This is the architecture the
// project brief describes: the app reads cached tables; only this scheduled job fans out to the
// provider. Per-instrument work is isolated so one failure never aborts the run.

type Held = {
  instrument_id: string;
  symbol: string;
  exchange: string;
  currency: string;
  name: string | null;
  sector: string | null;
  sector_weights: unknown | null;
  type: string | null;
};

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false; // fail closed — require a secret to be configured
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(request: Request) {
  if (!authorized(request)) return new Response("Unauthorized", { status: 401 });

  const admin = createAdminClient();
  // The positions view is security_invoker; the service-role client bypasses RLS, so this returns
  // every held position across all users. Dedupe to one row per instrument.
  const { data, error } = await admin
    .from("positions")
    .select("instrument_id, symbol, exchange, currency, name, sector, sector_weights, type");
  if (error) return new Response(error.message, { status: 500 });

  const byId = new Map<string, Held>();
  for (const p of (data ?? []) as Held[]) {
    if (!byId.has(p.instrument_id)) byId.set(p.instrument_id, p);
  }
  const held = [...byId.values()];

  let ok = 0;
  let failed = 0;
  const BATCH = 6;
  for (let i = 0; i < held.length; i += BATCH) {
    await Promise.all(
      held.slice(i, i + BATCH).map(async (p) => {
        try {
          await syncInstrumentQuote(admin, p.instrument_id, p.symbol, p.exchange, p.currency);
          await syncInstrumentDividends(admin, p.instrument_id, p.symbol, p.exchange, p.currency);
          await syncInstrumentPriceHistory(admin, p.instrument_id, p.symbol, p.exchange);

          if (!p.sector && !p.sector_weights) {
            await enrichInstrumentProfile(admin, {
              id: p.instrument_id, symbol: p.symbol, exchange: p.exchange, type: p.type,
            });
          }
          // Fill a real company name if the row still shows its bare ticker.
          if (!p.name || p.name.trim() === "" || p.name === p.symbol) {
            const meta = await searchInstrument(p.symbol, p.exchange);
            if (meta?.name && meta.name !== p.symbol) {
              await admin.from("instruments").update({ name: meta.name }).eq("id", p.instrument_id);
            }
          }
          ok++;
        } catch {
          failed++;
        }
      })
    );
  }

  return Response.json({ synced: ok, failed, total: held.length });
}
