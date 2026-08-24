// Server-only broker-sync core. Deliberately NOT a "use server" module: runBrokerSyncForUser takes a
// userId and writes via the service-role admin client, so it must never be exposed as a callable
// Server Action. Only server code may import it — the gated syncBrokerAccounts action (which checks
// the session + owner) and the CRON_SECRET-guarded nightly cron.
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { getBrokerProvider } from "@/lib/brokersync";
import type { BrokerAccount, BrokerPosition, BrokerOptionLeg, BrokerEquityTxn } from "@/lib/brokersync";
import { enrichInstrumentProfile } from "@/lib/enrich";
import { snapshotPortfolioValues } from "@/lib/snapshots";

export type BrokerSyncResult = {
  ok: boolean;
  message?: string;
  accounts?: number;
  holdings?: number;
  options?: number;
  debug?: string; // per-account option diagnostics (activities scanned / options found / errors)
};

function todayIso(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

async function resolveInstrument(
  admin: ReturnType<typeof createAdminClient>,
  symbol: string,
  exchange: string,
  currency: string,
  type: string = "stock",
  name?: string | null
): Promise<{ id: string; currency: string } | null> {
  const { data: existing } = await admin
    .from("instruments").select("id, currency, name").eq("symbol", symbol).eq("exchange", exchange).maybeSingle();
  if (existing) {
    // Backfill a real name if this instrument was created earlier with name = symbol.
    const e = existing as { id: string; currency: string; name: string | null };
    if (name && (!e.name || e.name === symbol)) {
      await admin.from("instruments").update({ name }).eq("id", e.id);
    }
    return { id: e.id, currency: e.currency };
  }
  // PHANTOM GUARD: never let a US-labeled equity shadow an existing REAL foreign listing of the
  // same ticker. The broker feeds intermittently mislabel an international holding (e.g. "1810 HK",
  // "D05 SI") as US — on the sync that does so, a US phantom instrument is spawned beside the real
  // one and reconciled to the full share count, doubling the holding's value. If a non-US,
  // non-crypto instrument already exists for this ticker, THAT is the real security — use it, and
  // never create the US twin. (Crypto is excluded: it has its own CRYPTO-market resolution, and a
  // US ticker must not be pulled onto a coin that happens to share its symbol.)
  if ((exchange || "US").toUpperCase() === "US" && type !== "crypto") {
    const { data: foreign } = await admin
      .from("instruments").select("id, currency")
      .eq("symbol", symbol).not("exchange", "in", "(US,CRYPTO)").limit(1).maybeSingle();
    if (foreign) {
      const f = foreign as { id: string; currency: string };
      return { id: f.id, currency: f.currency };
    }
  }
  // Use the broker's description as the name when present, so intl tickers show a company name
  // immediately instead of a bare code. Falls back to the symbol; "Refresh prices" enriches later.
  // Upsert (not insert) on the (symbol, exchange) unique key so concurrent account syncs resolving
  // the same ticker can't collide — the loser gets the existing row instead of a unique violation.
  const { data: created } = await admin.from("instruments").upsert(
    { symbol, exchange, name: name || symbol, currency: currency || "USD", type },
    { onConflict: "symbol,exchange" }
  ).select("id, currency").single();
  return (created as { id: string; currency: string } | null) ?? null;
}

// Each brokerage account maps to its own Snowfolio portfolio (named with the masked account #).
// All writes go through the service-role admin client (scoped explicitly by userId) so this works
// both from the signed-in action and the session-less nightly cron.
async function ensureBrokerPortfolio(
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
  account: BrokerAccount
): Promise<string | null> {
  const last4 = account.number ? account.number.slice(-4) : "";
  const suffix = account.label || (last4 ? `••••${last4}` : "");
  const name = suffix ? `${account.brokerageName} ${suffix}` : account.brokerageName || "Brokerage";

  const { data: existing } = await admin
    .from("broker_accounts").select("portfolio_id")
    .eq("user_id", userId).eq("provider", "snaptrade").eq("provider_account_id", account.id).maybeSingle();
  if (existing?.portfolio_id) {
    // Name is set once, at creation, then left alone — so a manual "Individual"/"Roth"
    // label (or any name the user picks) survives every future sync instead of being
    // overwritten back to a bare brokerage name.
    return existing.portfolio_id as string;
  }

  const { data: pf } = await admin.from("portfolios").insert({
    user_id: userId, name,
    broker: account.brokerageName, sync_provider: "snaptrade", is_auto_sync_enabled: true,
  }).select("id").single();
  const portfolioId = (pf as { id: string } | null)?.id ?? null;
  if (!portfolioId) return null;

  await admin.from("broker_accounts").upsert(
    {
      user_id: userId, provider: "snaptrade", provider_account_id: account.id,
      // Store only the last 4 digits — the UI only ever shows "••••1234", so full numbers at rest
      // are needless PII. provider_account_id (the SnapTrade id) is the stable key, not this.
      brokerage_name: account.brokerageName, account_number: account.number ? account.number.slice(-4) : null, portfolio_id: portfolioId,
      account_category: account.category || null, account_type: account.accountType || null,
      currency: account.currency || null, is_cash: account.isCash,
    },
    { onConflict: "user_id,provider,provider_account_id" }
  );
  return portfolioId;
}

// Session-agnostic core: pull every connected brokerage account and mirror it into the given user's
// Snowfolio. All DB writes go through the service-role admin client, scoped by userId. Callers MUST
// authorize first: the syncBrokerAccounts action checks the session + owner gate; the cron is
// CRON_SECRET-guarded and only passes owner user IDs. This function performs no auth of its own and
// is intentionally not a Server Action — see the module header.
export async function runBrokerSyncForUser(userId: string): Promise<BrokerSyncResult> {
  const provider = getBrokerProvider();
  if (!provider.isConfigured()) { console.error("[brokersync] not configured"); return { ok: false, message: "Broker sync isn't configured." }; }

  const admin = createAdminClient();
  let accounts: BrokerAccount[];
  try {
    accounts = await provider.listAccounts();
  } catch (e) {
    console.error("[brokersync] listAccounts threw:", String((e as { message?: string })?.message ?? e));
    return { ok: false, message: "Couldn't list brokerage accounts — try again." };
  }
  console.error(`[brokersync] START v4 · accounts=${accounts.length}`);
  const today = todayIso();
  const now = new Date().toISOString();
  const instBySymbol = new Map<string, { id: string; currency: string }>();
  const optionDebug: string[] = [];

  // Import option legs into a portfolio.
  //  • "accumulate" NEVER deletes — history persists in the DB forever, even years later when the
  //    broker/SnapTrade no longer returns those old trades. New legs are added; existing skipped.
  //    Used for the transaction-activities feed (immutable historical facts).
  //  • "snapshot" clears this source's prior rows then inserts — used for the current-open-positions
  //    fallback, where a position that has since closed must disappear.
  // Activities ("snaptrade-act") and positions ("snaptrade-pos") use separate prefixes so they
  // never clobber each other. Returns how many rows were written.
  async function importOptionLegs(
    portfolioId: string,
    legs: BrokerOptionLeg[],
    source: string,
    mode: "accumulate" | "snapshot"
  ): Promise<number> {
    if (mode === "snapshot") {
      await admin.from("option_transactions").delete()
        .eq("portfolio_id", portfolioId).like("dedupe_key", `opt:${source}:%`);
    }
    if (!legs.length) return 0;
    const optRows: {
      portfolio_id: string; instrument_id: string; action: string; option_type: string;
      strike: number; expiration: string; contracts: number; premium: number; fee: number;
      trade_date: string; currency: string; dedupe_key: string;
    }[] = [];
    for (const leg of legs) {
      const key = `${leg.underlying}|${leg.exchange}`;
      let inst = instBySymbol.get(key);
      if (!inst) {
        const resolved = await resolveInstrument(admin, leg.underlying, leg.exchange, leg.currency, "stock");
        if (!resolved) continue;
        inst = resolved;
        instBySymbol.set(key, inst);
      }
      optRows.push({
        portfolio_id: portfolioId, instrument_id: inst.id, action: leg.action,
        option_type: leg.optionType, strike: leg.strike, expiration: leg.expiration,
        contracts: leg.contracts, premium: leg.premiumPerShare, fee: leg.fee,
        trade_date: leg.tradeDate, currency: leg.currency,
        dedupe_key: `opt:${source}:${leg.ref}`,
      });
    }
    if (!optRows.length) return 0;
    // ignoreDuplicates keeps already-imported rows untouched — the accumulate guarantee.
    await admin.from("option_transactions")
      .upsert(optRows, { onConflict: "portfolio_id,dedupe_key", ignoreDuplicates: true });
    return optRows.length;
  }

  // Import real, dated equity transactions (buys/sells/dividends) and reconcile to the broker's
  // current holdings. The real rows ACCUMULATE (ref:snaptrade-act:* — never deleted, so history
  // persists forever). Then, per currently-held instrument, we add ONE opening-balance lot for any
  // gap between the shares those trades imply and what the broker reports now (transfers-in,
  // pre-window shares, splits) — so current holdings still match the broker EXACTLY, while giving
  // true value-over-time and cost basis. `heldByInst` is the broker's current snapshot.
  async function importEquityHistory(
    portfolioId: string,
    txns: BrokerEquityTxn[],
    heldByInst: Map<string, { shares: number; avgCost: number; currency: string; symbol: string }>,
    heldTickers: Map<string, string>, // ticker → instrument_id from the position snapshot (authoritative exchange)
    brokerIsCrypto: boolean // Coinbase et al: activity tickers are crypto, priced as SYMBOL-USD not US equity
  ): Promise<{ count: number; error?: string }> {
    type Row = {
      portfolio_id: string; instrument_id: string; type: string; quantity: number; price: number;
      fees: number; currency: string; executed_at: string; dedupe_key: string; note?: string;
    };
    // Dedupe rows by dedupe_key: SnapTrade can emit several legs sharing one reference id, and a
    // single INSERT … ON CONFLICT cannot touch the same key twice — one dup would fail the whole batch.
    const byKey = new Map<string, Row>();
    const computedByInst = new Map<string, number>();
    const earliestByInst = new Map<string, string>();
    const metaByInst = new Map<string, { firstPrice: number; currency: string }>();
    let earliestOverall: string | null = null;

    for (const tx of txns) {
      // Skip anything numerically unsound — one bad row would otherwise reject the whole batch.
      if (!Number.isFinite(tx.quantity) || !Number.isFinite(tx.price) || tx.quantity <= 0) continue;
      // On a crypto broker (Coinbase), normalize the activity ticker the SAME way positions do
      // (strip the -USD pair suffix, force the CRYPTO market) so an activity-only coin — one not in
      // the current positions snapshot, e.g. a fully-sold ARB — resolves to the real crypto
      // instrument instead of spawning a US-equity phantom with a wrong "stock" price.
      let sym = tx.symbol;
      let ex = tx.exchange;
      let instType = "stock";
      if (brokerIsCrypto) {
        sym = (sym.replace(/[-/]?(USD|USDC|USDT)$/i, "") || sym).toUpperCase();
        ex = "CRYPTO";
        instType = "crypto";
      }
      // Prefer the instrument the POSITION snapshot already established for this ticker. The activity
      // feed sometimes reports a wrong/US exchange for an intl holding; without this, that would spawn
      // a PHANTOM duplicate (e.g. "1810 US" alongside the real "1810 HK"), doubling the value.
      let instId = heldTickers.get(sym);
      if (!instId) {
        const k = `${sym}|${ex}`;
        let inst = instBySymbol.get(k);
        if (!inst) {
          const resolved = await resolveInstrument(admin, sym, ex, tx.currency, instType, tx.name);
          if (!resolved) continue;
          inst = resolved;
          instBySymbol.set(k, inst);
        }
        instId = inst.id;
      }
      const dk = `ref:snaptrade-act:${tx.ref}`;
      if (byKey.has(dk)) continue;
      byKey.set(dk, {
        portfolio_id: portfolioId, instrument_id: instId, type: tx.txnType,
        quantity: tx.quantity, price: tx.price, fees: Number.isFinite(tx.fee) ? tx.fee : 0,
        currency: tx.currency, executed_at: tx.tradeDate, dedupe_key: dk,
      });
      if (tx.txnType === "buy") computedByInst.set(instId, (computedByInst.get(instId) ?? 0) + tx.quantity);
      else if (tx.txnType === "sell") computedByInst.set(instId, (computedByInst.get(instId) ?? 0) - tx.quantity);
      if (tx.txnType !== "dividend") {
        if (!earliestByInst.has(instId) || tx.tradeDate < earliestByInst.get(instId)!) {
          earliestByInst.set(instId, tx.tradeDate);
          metaByInst.set(instId, { firstPrice: tx.price, currency: tx.currency });
        }
        if (!earliestOverall || tx.tradeDate < earliestOverall) earliestOverall = tx.tradeDate;
      }
    }
    const rows = [...byKey.values()];
    if (!rows.length) return { count: 0 };

    // Only NOW touch the DB. Drop the legacy today-snapshot and prior reconciling lots (both recomputed
    // here); the accumulated real trades (ref:snaptrade-act:*) are left untouched.
    const delPos = await admin.from("transactions").delete().eq("portfolio_id", portfolioId).like("dedupe_key", "ref:snaptrade-pos:%");
    if (delPos.error) return { count: 0, error: `del pos: ${delPos.error.message}` };
    await admin.from("transactions").delete().eq("portfolio_id", portfolioId).like("dedupe_key", "ref:snaptrade-recon:%");

    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await admin.from("transactions")
        .upsert(rows.slice(i, i + 500), { onConflict: "portfolio_id,dedupe_key", ignoreDuplicates: true });
      if (error) return { count: 0, error: `equity upsert: ${error.message}` };
    }

    // Reconcile EVERY instrument the trades touched (held + activity-only) to the broker's current
    // shares: held → broker shares; activity-only (fully exited, or a phantom from a wrong exchange)
    // → 0. This clears both negative "sold pre-window" balances and any duplicate phantom.
    const targetIds = new Set<string>([...heldByInst.keys(), ...computedByInst.keys()]);
    const reconRows: Row[] = [];
    for (const instId of targetIds) {
      const held = heldByInst.get(instId);
      const target = held?.shares ?? 0;
      const computed = computedByInst.get(instId) ?? 0;
      const diff = target - computed;
      if (Math.abs(diff) < 1e-6) continue;
      const meta = metaByInst.get(instId);
      reconRows.push({
        portfolio_id: portfolioId, instrument_id: instId,
        type: diff > 0 ? "buy" : "sell", quantity: Math.abs(diff),
        price: held ? (Number.isFinite(held.avgCost) ? held.avgCost : 0) : (meta?.firstPrice ?? 0),
        fees: 0, currency: held?.currency ?? meta?.currency ?? "USD",
        executed_at: earliestByInst.get(instId) ?? earliestOverall ?? today,
        dedupe_key: `ref:snaptrade-recon:${instId}`,
        note: held ? "Opening balance (reconciled to broker)" : "Adjustment (no longer held)",
      });
    }
    if (reconRows.length) {
      const { error } = await admin.from("transactions").insert(reconRows);
      if (error) return { count: rows.length, error: `recon: ${error.message}` };
    }

    return { count: rows.length + reconRows.length };
  }

  // Process one brokerage account end-to-end. Returns its counts + diagnostics so the accounts can
  // run concurrently without racing on shared counters.
  async function processAccount(account: BrokerAccount): Promise<{ holdings: number; optionLegs: number; debug: string[] }> {
    const debug: string[] = [];
    let holdings = 0;
    let optionLegs = 0;

    // For investment/crypto (non-cash) accounts, pull positions first and skip any that hold
    // nothing — an empty sub-account (e.g. an unused Robinhood crypto account) shouldn't create a
    // clutter portfolio. Cash accounts are kept regardless: they're tracked by balance, not holdings.
    let positions: BrokerPosition[] = [];
    if (!account.isCash) {
      positions = await provider.getPositions(account.id);
      if (positions.length === 0) return { holdings, optionLegs, debug };
    }

    const portfolioId = await ensureBrokerPortfolio(admin, userId, account);
    if (!portfolioId) return { holdings, optionLegs, debug };

    // Record the account's balance/category snapshot (and raw shape) on every sync.
    await admin.from("broker_accounts")
      .update({
        last_synced_at: now,
        cash_balance: account.cashBalance,
        account_category: account.category || null,
        account_type: account.accountType || null,
        currency: account.currency || null,
        is_cash: account.isCash,
        raw: account.raw ?? null,
      })
      .eq("user_id", userId).eq("provider", "snaptrade").eq("provider_account_id", account.id);

    // Cash / deposit accounts (e.g. Chase) carry no tradable positions — they're tracked on the
    // Cash & ledger page from the balance above, not as stock holdings. Skip the positions pass.
    if (account.isCash) return { holdings, optionLegs, debug };

    // Coinbase (and any crypto-typed position) is priced as SYMBOL-USD, not as a US equity.
    const brokerIsCrypto = /coinbase/i.test(account.brokerageName);
    const acctLabel = account.label || account.brokerageName || account.id.slice(0, 6);

    // Dedupe the broker's positions by ticker: the feed can report one international holding TWICE —
    // its real market plus a mislabeled "US" — which would otherwise create a duplicate listing with
    // double the value. Keep the real (non-US) market when a ticker conflicts.
    const posByTicker = new Map<string, BrokerPosition>();
    for (const pos of positions) {
      if (!pos.symbol) continue;
      const t = pos.symbol.toUpperCase();
      const existing = posByTicker.get(t);
      if (!existing) { posByTicker.set(t, pos); continue; }
      const exNew = (pos.exchange || "US").toUpperCase();
      const exOld = (existing.exchange || "US").toUpperCase();
      if (exOld === "US" && exNew !== "US") posByTicker.set(t, pos); // prefer the non-US (real) market
    }
    const dedupedPositions = [...posByTicker.values()];

    // DIAGNOSTIC (sync-v3): show any ticker the feed returned under more than one exchange — the
    // root of the duplicate listings — so we can see whether the dedupe is engaging.
    if (positions.length !== dedupedPositions.length) {
      const seen = new Map<string, string[]>();
      for (const pos of positions) {
        if (!pos.symbol) continue;
        const t = pos.symbol.toUpperCase();
        (seen.get(t) ?? seen.set(t, []).get(t)!).push((pos.exchange || "US").toUpperCase());
      }
      const dups = [...seen.entries()].filter(([, ex]) => ex.length > 1).map(([t, ex]) => `${t}[${ex.join("/")}]`);
      debug.push(`${acctLabel} raw-pos ${positions.length}→${dedupedPositions.length} deduped${dups.length ? ` · dup: ${dups.slice(0, 10).join(" ")}` : ""}`);
    } else if (/interactive|ibkr/i.test(account.brokerageName)) {
      debug.push(`${acctLabel} raw-pos ${positions.length} (no ticker dupes seen — feed uses distinct symbols)`);
    }

    // Resolve instruments for the CURRENT positions, cache the broker's last price, and record what
    // the broker says you hold now (instrument_id → shares, avg cost). This feeds both the equity
    // snapshot fallback and the real-history reconciliation.
    const heldByInst = new Map<string, { shares: number; avgCost: number; currency: string; symbol: string }>();
    const heldTickers = new Map<string, string>(); // ticker → instrument_id (authoritative exchange from the broker's positions)
    const priceRows: { instrument_id: string; price: number; currency: string; as_of: string }[] = [];
    for (const pos of dedupedPositions) {
      if (!pos.symbol || !pos.units || pos.units <= 0) continue;
      const isCrypto = pos.isCrypto || brokerIsCrypto;
      let symbol = pos.symbol.toUpperCase();
      // Use the broker's real exchange (HK, TW, SS, SI, KL, …) so intl holdings aren't mislabeled
      // as US and price/dividend lookups resolve to the right market. Defaults to US.
      let exchange = (pos.exchange || "US").toUpperCase();
      let instType = "stock";
      if (isCrypto) {
        symbol = symbol.replace(/[-/]?(USD|USDC|USDT)$/i, "") || symbol; // BTC-USD -> BTC
        exchange = "CRYPTO";
        instType = "crypto";
      }
      const key = `${symbol}|${exchange}`;
      let inst = instBySymbol.get(key);
      if (!inst) {
        const resolved = await resolveInstrument(admin, symbol, exchange, pos.currency ?? "USD", instType, pos.name);
        if (!resolved) continue;
        inst = resolved;
        instBySymbol.set(key, inst);
      }
      const currency = pos.currency || inst.currency || "USD";
      heldByInst.set(inst.id, { shares: pos.units, avgCost: pos.avgCost ?? pos.price ?? 0, currency, symbol });
      heldTickers.set(symbol, inst.id);
      if (pos.price != null) priceRows.push({ instrument_id: inst.id, price: pos.price, currency, as_of: now });
    }
    if (priceRows.length) await admin.from("price_cache").upsert(priceRows);

    // --- Full activity history (one fetch): real equity trades + option legs ---
    let activitiesHaveOptions = false;
    let equityFromActivities = false;
    if (provider.getActivities) {
      const act = await provider.getActivities(account.id);
      const ts = account.txnSync;
      const tsNote = ts ? ` {txnSync: initialDone=${ts.initialDone}, firstTxn=${ts.firstDate ?? "none"}}` : "";
      debug.push(
        act.error
          ? `${acctLabel}: activities error — ${act.error}`
          : `${acctLabel}: ${act.scanned} activities · ${act.equityRows} equity · ${act.optionRows} option${act.scanned === 0 && act.shape ? ` [resp: ${act.shape}]` : ""}${tsNote}`
      );
      activitiesHaveOptions = act.optionRows > 0;
      // Accumulate: option history is never deleted, so a 2025 trade stays even in 2030.
      optionLegs += await importOptionLegs(portfolioId, act.optionLegs, "snaptrade-act", "accumulate");

      // Real dated equity history (buys/sells/dividends) + reconciliation to the broker snapshot.
      equityFromActivities = act.equityRows > 0;
      if (equityFromActivities) {
        const eq = await importEquityHistory(portfolioId, act.equityTxns, heldByInst, heldTickers, brokerIsCrypto);
        holdings += eq.count;
        if (eq.error) {
          // Don't lose the account's holdings on an import error — surface it and fall back to the snapshot.
          debug.push(`${acctLabel}: equity import error — ${eq.error}`);
          equityFromActivities = false;
        }
      }
    }

    // Equity snapshot FALLBACK — only when the activity feed gave us no real equity history. A
    // synthetic "today" buy at the broker's cost basis, snapshot-refreshed each sync.
    if (!equityFromActivities) {
      await admin.from("transactions").delete().eq("portfolio_id", portfolioId).like("dedupe_key", "ref:snaptrade-pos:%");
      const rows = [...heldByInst.entries()].map(([instId, h]) => ({
        portfolio_id: portfolioId, instrument_id: instId, type: "buy",
        quantity: h.shares, price: h.avgCost, fees: 0, currency: h.currency, executed_at: today,
        dedupe_key: `ref:snaptrade-pos:${account.id}:${h.symbol}`,
      }));
      if (rows.length) await admin.from("transactions").insert(rows);
      holdings += rows.length;
    }

    if (provider.getOptionPositions) {
      if (activitiesHaveOptions) {
        // Activities already cover this account's options — clear any stale positions-fallback rows
        // so they don't double-count, and skip the positions import.
        await importOptionLegs(portfolioId, [], "snaptrade-pos", "snapshot");
      } else {
        const pos = await provider.getOptionPositions(account.id);
        debug.push(
          pos.error
            ? `${acctLabel}: positions error — ${pos.error}`
            : `${acctLabel}: ${pos.optionPositions} open option pos, ${pos.legs.length} imported (fallback)${pos.sample ? ` [${pos.sample}]` : ""}`
        );
        optionLegs += await importOptionLegs(portfolioId, pos.legs, "snaptrade-pos", "snapshot");
      }
    }
    return { holdings, optionLegs, debug };
  }

  // Run accounts concurrently in small batches — the slow part is provider round-trips, so this
  // cuts wall-clock roughly by the batch size while staying under SnapTrade's rate limits.
  let holdings = 0;
  let optionLegs = 0;
  const ACCOUNT_BATCH = 4;
  for (let i = 0; i < accounts.length; i += ACCOUNT_BATCH) {
    // Fault-isolate each account: one throwing account must never abort the whole sync (which would
    // leave every account unwritten). Log the stack so the culprit is visible in runtime logs.
    const settled = await Promise.all(accounts.slice(i, i + ACCOUNT_BATCH).map(async (a) => {
      try {
        return await processAccount(a);
      } catch (e) {
        const msg = String((e as { stack?: string; message?: string })?.stack ?? (e as { message?: string })?.message ?? e).slice(0, 600);
        console.error(`[brokersync] account "${a.label || a.brokerageName}" threw: ${msg}`);
        return { holdings: 0, optionLegs: 0, debug: [`${a.label || a.brokerageName}: sync error — ${msg.slice(0, 120)}`] };
      }
    }));
    for (const r of settled) {
      holdings += r.holdings;
      optionLegs += r.optionLegs;
      optionDebug.push(...r.debug);
    }
  }
  console.error(`[brokersync] DONE · holdings=${holdings} options=${optionLegs}`);

  // Enrich sector/country for the synced instruments (only those still missing it), in a small
  // dedicated batched pass so the calls aren't rate-limited like they are inside the price refresh.
  const instIds = [...instBySymbol.values()].map((i) => i.id);
  if (instIds.length) {
    const { data: need } = await admin
      .from("instruments").select("id, symbol, exchange, type")
      .in("id", instIds).is("sector", null).is("sector_weights", null);
    const list = (need ?? []) as { id: string; symbol: string; exchange: string; type: string | null }[];
    for (let i = 0; i < list.length; i += 6) {
      await Promise.all(list.slice(i, i + 6).map((inst) => enrichInstrumentProfile(admin, inst)));
    }
  }

  // Record today's value for every account, so the permanent value-over-time history advances on a
  // manual sync too (not only the nightly job). Idempotent per day; isolated so it never fails a sync.
  try {
    await snapshotPortfolioValues(admin);
  } catch (e) {
    console.error("[brokersync] snapshot failed:", String((e as { message?: string })?.message ?? e));
  }

  revalidatePath("/dashboard");
  revalidatePath("/dashboard/broker");
  revalidatePath("/dashboard/options");
  revalidatePath("/dashboard/performance");
  return {
    ok: true, accounts: accounts.length, holdings, options: optionLegs,
    debug: optionDebug.length ? optionDebug.join(" · ") : undefined,
  };
}
