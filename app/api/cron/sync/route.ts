import { createAdminClient } from "@/lib/supabase/admin";
import {
  syncInstrumentQuote,
  syncInstrumentDividends,
  syncInstrumentSplits,
  syncInstrumentPriceHistory,
  syncIvSample,
} from "@/lib/marketdata/sync";
import { enrichInstrumentProfile } from "@/lib/enrich";
import { searchInstrument, providerSupportsOptions, providerName, providerConfigError } from "@/lib/marketdata";
import { FINDER_UNIVERSE } from "@/lib/options/finder-universe";
import { runBrokerSyncForUser } from "@/lib/brokersync/run";
import { isBrokerSyncOwner } from "@/lib/brokersync";
import { snapshotPortfolioValues } from "@/lib/snapshots";
import { syncFxRates } from "@/lib/fx";
import { fetchAll } from "@/lib/supabase/paginate";
import { takeProviderCallCount } from "@/lib/marketdata";
import { recordSyncRun, listAllUserEmails } from "@/lib/cron";
import { sendEmail, emailShell, emailConfig, reportEmailFailure } from "@/lib/email";

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

  // --- Provider preflight ----------------------------------------------------------------------
  // A provider switch is two environment variables, and getting one of them wrong fails silently:
  // the run completes, writes nothing, and every price freezes. Check first, record the verdict,
  // and tell the founder — a stale dashboard should never be the first sign of a bad config.
  const configError = providerConfigError();
  if (configError) {
    console.error(`[cron:sync] provider config: ${configError.message}`);
    const owner = (process.env.BROKER_SYNC_OWNER_EMAILS ?? "").split(",")[0]?.trim();
    if (owner) {
      const res = await sendEmail(
        owner,
        `Snowfolio sync: market-data provider ${configError.fatal ? "misconfigured" : "warning"}`,
        emailShell(
          "Provider configuration",
          `<p style="margin:0 0 10px;font-size:14px;color:#334155">${configError.message}</p>` +
            `<p style="font-size:12px;color:#64748b">${configError.fatal ? "This run was aborted; no data was written or changed." : "The run continued on the fallback provider."}</p>`
        )
      );
      reportEmailFailure("sync", res);
    }
    if (configError.fatal) {
      // Abort rather than spend thousands of requests confirming the same thing per instrument.
      // Nothing is written, so the previous night's cached data stays intact and correct.
      await recordSyncRun(
        admin, "sync", startedAt,
        { aborted: true, provider: providerName(), reason: configError.message },
        []
      );
      return Response.json({ ok: false, aborted: true, error: configError.message }, { status: 500 });
    }
  }

  // --- Brokerage auto-sync (runs first, so newly-synced holdings get priced in the same run) ---
  // Candidates are exactly the accounts on the BROKER_SYNC_OWNER_EMAILS allowlist: the SnapTrade
  // integration authenticates with a single PERSONAL key, so syncing anyone else would pull the
  // key owner's real brokerage accounts into a stranger's dashboard.
  //
  // Resolve those emails to user ids through the paginated helper. Two wrong ways to do this, both
  // of which this avoids: a bare auth.admin.listUsers() silently drops everyone past page 1 once
  // the app has ~50 signups, and reading broker_connections finds nobody at all — that table backs
  // a future per-user connect flow and nothing writes to it today, so discovering candidates from
  // it meant the nightly broker sync quietly did nothing while the market-data sync kept working.
  // Failures here never abort the run.
  let brokerSynced = 0;
  let brokerOwners = 0;
  try {
    const emails = await listAllUserEmails(admin);
    const owners = [...emails.entries()].filter(([, email]) => isBrokerSyncOwner(email));
    if (!owners.length) {
      // Not an error — broker sync is off unless an owner is configured — but it must be visible,
      // because "nothing synced" and "nothing to sync" look identical from the outside.
      console.log("[cron:sync] broker sync: no account matches BROKER_SYNC_OWNER_EMAILS — skipped");
    }
    for (const [uid] of owners) {
      brokerOwners++;
      const res = await runBrokerSyncForUser(uid);
      if (res.ok) brokerSynced += res.options ?? 0;
      else console.error(`[cron:sync] broker sync failed: ${res.message}`);
    }
  } catch (e) {
    console.error("[cron:sync] broker sync threw:", e); // isolate — market-data sync still runs
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
  // Splits are counted apart from `synced`: a split that was fetched but couldn't be stored leaves
  // the instrument otherwise fine, so failing it outright would be wrong — but so is staying quiet,
  // because an unwritten split misstates cost basis on every page that reads it.
  let splitsWritten = 0;
  let splitsUnstored = 0;
  const BATCH = 6;
  for (let i = 0; i < held.length; i += BATCH) {
    await Promise.all(
      held.slice(i, i + BATCH).map(async (p) => {
        try {
          await syncInstrumentQuote(admin, p.instrument_id, p.symbol, p.exchange, p.currency);
          await syncInstrumentDividends(admin, p.instrument_id, p.symbol, p.exchange, p.currency);
          // Splits before price history: both feed the value chart, and a chart drawn from
          // adjusted closes against unadjusted share counts has a cliff in it on the split date.
          const written = await syncInstrumentSplits(admin, p.instrument_id, p.symbol, p.exchange);
          if (written == null) splitsUnstored++;
          else splitsWritten += written;
          await syncInstrumentPriceHistory(admin, p.instrument_id, p.symbol, p.exchange, undefined, p.currency);

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
    // Which provider actually served the run — the one number that confirms a switch took effect,
    // read back from sync_runs after the first night on a new provider.
    provider: providerName(),
    synced: ok, failed, total: held.length, ivCaptured: ivOk,
    // brokerOwners answers "did it even try" — brokerOptionLegs of 0 never distinguished a
    // clean run with no new legs from a sync that never ran at all.
    brokerOwners, brokerOptionLegs: brokerSynced, valueSnapshots, fxUpdated,
    // splitsUnstored > 0 means the provider returned splits that did not reach the database —
    // most likely supabase/schema.sql has not been applied since the splits feature shipped.
    splitsWritten, splitsUnstored,
    providerCalls: takeProviderCallCount(),
    // Whether the failure email below could actually be delivered. A dead notification path is
    // worth knowing about on a GOOD night, not discovered on the bad one.
    ...emailConfig(),
  };
  await recordSyncRun(admin, "sync", startedAt, summary, failedSymbols);
  // Also emit the summary to the platform log. sync_runs is the durable record, but it needs
  // database access to read; this line makes a run diagnosable from the deployment logs alone —
  // which is the difference between "the switch worked" and "nobody can tell". Counts and a
  // provider name only: no user data, no secrets.
  console.log(`[cron:sync] summary ${JSON.stringify({ ...summary, durationMs: Date.now() - startedAt })}`);

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
      const res = await sendEmail(owner, `Snowfolio sync: ${failed} failure${failed === 1 ? "" : "s"}`, emailShell("Sync report", body));
      // If this send fails the founder never learns the sync failed — log it loudly rather than
      // letting a broken alert path hide a broken sync.
      reportEmailFailure("sync", res);
    }
  }

  return Response.json(summary);
}
