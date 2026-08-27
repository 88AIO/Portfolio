import { createAdminClient } from "@/lib/supabase/admin";
import {
  syncInstrumentQuote,
  syncInstrumentDividends,
  syncInstrumentPriceHistory,
  syncIvSample,
} from "@/lib/marketdata/sync";
import { enrichInstrumentProfile } from "@/lib/enrich";
import { searchInstrument, providerSupportsOptions } from "@/lib/marketdata";
import { FINDER_UNIVERSE } from "@/lib/options/finder-universe";
import { runBrokerSyncForUser } from "@/lib/brokersync/run";
import { isBrokerSyncOwner } from "@/lib/brokersync";
import { snapshotPortfolioValues } from "@/lib/snapshots";
import { syncFxRates } from "@/lib/fx";
import { fetchAll } from "@/lib/supabase/paginate";
import { takeProviderCallCount } from "@/lib/marketdata";
import { recordSyncRun } from "@/lib/cron";
import { sendEmail, emailShell } from "@/lib/email";

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

  const startedAt = Date.now();
  takeProviderCallCount(); // reset the counter so the summary reflects only this run
  const admin = createAdminClient();

  // --- Brokerage auto-sync (runs first, so newly-synced holdings get priced in the same run) ---
  // Candidates are the users with a broker_connections row (only the owner-gated connect flow can
  // create one), then each is re-verified against BROKER_SYNC_OWNER_EMAILS before syncing — the
  // personal SnapTrade key only reads the owner's accounts, so we must only ever sync into an
  // owner's own portfolios. Deliberately NOT a bare auth.admin.listUsers() scan: its default
  // pagination silently drops users beyond page 1 past ~50 signups, which would quietly kill the
  // founder's own nightly sync as the user base grows. Failures here never abort the run.
  let brokerSynced = 0;
  try {
    const { data: conns } = await admin.from("broker_connections").select("user_id");
    const candidateIds = [...new Set((conns ?? []).map((c: { user_id: string }) => c.user_id))];
    for (const uid of candidateIds) {
      const { data: u } = await admin.auth.admin.getUserById(uid);
      if (!isBrokerSyncOwner(u?.user?.email)) continue;
      const res = await runBrokerSyncForUser(uid);
      if (res.ok) brokerSynced += res.options ?? 0;
    }
  } catch (e) {
    console.error("[cron:sync] broker sync failed:", e); // isolate — market-data sync still runs
  }

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
  const failedSymbols: string[] = [];
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
        } catch (e) {
          failed++;
          failedSymbols.push(`${p.symbol}.${p.exchange}`);
          console.error(`[cron:sync] ${p.symbol}.${p.exchange} failed:`, e);
        }
      })
    );
  }

  // Capture a daily IV sample for every US name the O3 put finder can scan (held + its seed
  // universe), so IV Rank builds a trailing range even on days no one runs a manual scan.
  // Skipped wholesale when the provider has no option chains, so the run doesn't spend a few
  // hundred no-op iterations discovering that one symbol at a time.
  const ivUniverse = providerSupportsOptions()
    ? [...new Set([
        ...held.filter((p) => (p.exchange ?? "US").toUpperCase() === "US").map((p) => p.symbol.toUpperCase()),
        ...FINDER_UNIVERSE,
      ])]
    : [];
  let ivOk = 0;
  for (let i = 0; i < ivUniverse.length; i += BATCH) {
    await Promise.all(
      ivUniverse.slice(i, i + BATCH).map(async (sym) => {
        try { if (await syncIvSample(admin, sym, "US")) ivOk++; } catch (e) { console.error(`[cron:sync] IV sample ${sym} failed:`, e); }
      })
    );
  }

  // Refresh the FX cache from the live provider so pages never call it at render time. Isolated.
  let fxUpdated = 0;
  try {
    fxUpdated = await syncFxRates(admin);
  } catch (e) {
    console.error("[cron:sync] FX refresh failed:", e); // keep prior cached rates on failure
  }

  // Record today's value for every account (after fresh prices + FX), building the permanent
  // value-over-time history. Runs regardless of trading activity; isolated so it never aborts sync.
  let valueSnapshots = 0;
  try {
    valueSnapshots = await snapshotPortfolioValues(admin);
  } catch (e) {
    console.error("[cron:sync] snapshot failed:", e); // isolate — must not fail the whole sync
  }

  const summary = {
    synced: ok, failed, total: held.length, ivCaptured: ivOk,
    brokerOptionLegs: brokerSynced, valueSnapshots, fxUpdated,
    providerCalls: takeProviderCallCount(),
  };
  await recordSyncRun(admin, "sync", startedAt, summary, failedSymbols);

  // Wake the founder when a run goes wrong: any failures, or a run that synced nothing while
  // holdings exist (a dead provider or a mid-run timeout). Best-effort — the founder emails are the
  // BROKER_SYNC_OWNER_EMAILS list, and sendEmail no-ops without a Resend key.
  if (failed > 0 || (ok === 0 && held.length > 0)) {
    const owner = (process.env.BROKER_SYNC_OWNER_EMAILS ?? "").split(",")[0]?.trim();
    if (owner) {
      const body =
        `<p style="margin:0 0 10px;font-size:14px;color:#334155">Nightly sync finished with problems.</p>` +
        `<pre style="font-size:12px;background:#f8fafc;padding:10px;border-radius:8px">${JSON.stringify(summary, null, 2)}</pre>` +
        (failedSymbols.length ? `<p style="font-size:12px;color:#64748b">Failed: ${failedSymbols.join(", ")}</p>` : "");
      await sendEmail(owner, `Snowfolio sync: ${failed} failure${failed === 1 ? "" : "s"}`, emailShell("Sync report", body));
    }
  }

  return Response.json(summary);
}
