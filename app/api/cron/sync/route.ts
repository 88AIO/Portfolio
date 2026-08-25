import { createAdminClient } from "@/lib/supabase/admin";
import {
  syncInstrumentQuote,
  syncInstrumentDividends,
  syncInstrumentPriceHistory,
  syncIvSample,
} from "@/lib/marketdata/sync";
import { enrichInstrumentProfile } from "@/lib/enrich";
import { searchInstrument } from "@/lib/marketdata";
import { FINDER_UNIVERSE } from "@/lib/options/finder-universe";
import { runBrokerSyncForUser } from "@/lib/brokersync/run";
import { isBrokerSyncOwner } from "@/lib/brokersync";
import { snapshotPortfolioValues } from "@/lib/snapshots";
import { syncFxRates } from "@/lib/fx";
import { fetchAll } from "@/lib/supabase/paginate";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

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

  // --- Brokerage auto-sync (runs first, so newly-synced holdings get priced in the same run) ---
  // Pull each owner's connected brokerages so options/holdings self-update nightly with no clicks.
  // Gated to BROKER_SYNC_OWNER_EMAILS — the personal SnapTrade key only reads the owner's accounts,
  // so we must only ever sync into an owner's own portfolios. Failures here never abort the run.
  let brokerSynced = 0;
  try {
    const { data: userList } = await admin.auth.admin.listUsers();
    const ownerIds = (userList?.users ?? []).filter((u) => isBrokerSyncOwner(u.email)).map((u) => u.id);
    for (const uid of ownerIds) {
      const res = await runBrokerSyncForUser(uid);
      if (res.ok) brokerSynced += res.options ?? 0;
    }
  } catch { /* isolate — market-data sync still runs */ }

  // The positions view is security_invoker; the service-role client bypasses RLS, so this returns
  // every held position across all users. Page past the ~1000-row cap — once total held rows exceed
  // it (a few dozen active users), a single read would silently skip every instrument beyond the
  // first page and leave their prices/dividends stale indefinitely. Dedupe to one row per instrument.
  const data = await fetchAll<Held>((from, to) =>
    admin
      .from("positions")
      .select("instrument_id, symbol, exchange, currency, name, sector, sector_weights, type")
      .order("instrument_id", { ascending: true })
      .order("portfolio_id", { ascending: true })
      .range(from, to),
  );

  const byId = new Map<string, Held>();
  for (const p of data as Held[]) {
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

  // Capture a daily IV sample for every US name the O3 put finder can scan (held + its seed
  // universe), so IV Rank builds a trailing range even on days no one runs a manual scan.
  const ivUniverse = [...new Set([
    ...held.filter((p) => (p.exchange ?? "US").toUpperCase() === "US").map((p) => p.symbol.toUpperCase()),
    ...FINDER_UNIVERSE,
  ])];
  let ivOk = 0;
  for (let i = 0; i < ivUniverse.length; i += BATCH) {
    await Promise.all(
      ivUniverse.slice(i, i + BATCH).map(async (sym) => {
        try { if (await syncIvSample(admin, sym, "US")) ivOk++; } catch { /* isolate per-name */ }
      })
    );
  }

  // Refresh the FX cache from the live provider so pages never call it at render time. Isolated.
  let fxUpdated = 0;
  try {
    fxUpdated = await syncFxRates(admin);
  } catch { /* keep prior cached rates on failure */ }

  // Record today's value for every account (after fresh prices + FX), building the permanent
  // value-over-time history. Runs regardless of trading activity; isolated so it never aborts sync.
  let valueSnapshots = 0;
  try {
    valueSnapshots = await snapshotPortfolioValues(admin);
  } catch { /* isolate — a snapshot failure must not fail the whole sync */ }

  return Response.json({ synced: ok, failed, total: held.length, ivCaptured: ivOk, brokerOptionLegs: brokerSynced, valueSnapshots, fxUpdated });
}
