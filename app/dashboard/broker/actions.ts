"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getBrokerProvider, isBrokerSyncOwner } from "@/lib/brokersync";
import type { BrokerAccount, BrokerPosition, BrokerOptionLeg } from "@/lib/brokersync";
import { enrichInstrumentProfile } from "@/lib/enrich";
import { transactionDedupeKey } from "@/lib/import/csv";

type BrokerSyncResult = {
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

// Signed-in entry point: verify the caller is the SnapTrade key owner, then run the sync for them.
export async function syncBrokerAccounts(): Promise<BrokerSyncResult> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Not signed in." };

  // SECURITY GATE: the personal-key SnapTrade integration can only read the key owner's real
  // accounts, so it must never run for a non-owner (it would import the owner's holdings into
  // their dashboard). Restrict to BROKER_SYNC_OWNER_EMAILS until a per-user connection flow exists.
  if (!isBrokerSyncOwner(user.email)) {
    return { ok: false, message: "Broker sync is limited to the account owner on this instance." };
  }
  return runBrokerSyncForUser(user.id);
}

// Session-agnostic core: pull every connected brokerage account and mirror it into the given user's
// Snowfolio. All DB writes go through the service-role admin client, scoped by userId, so this runs
// identically from the signed-in action above and the nightly cron. The CALLER is responsible for
// the owner-gate (the action checks the session; the cron only passes owner user IDs).
export async function runBrokerSyncForUser(userId: string): Promise<BrokerSyncResult> {
  const provider = getBrokerProvider();
  if (!provider.isConfigured()) return { ok: false, message: "Broker sync isn't configured." };

  const admin = createAdminClient();
  const accounts = await provider.listAccounts();
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

    // Equity holdings are a current snapshot: clear this account's prior synced rows, then insert.
    await admin
      .from("transactions")
      .delete()
      .eq("portfolio_id", portfolioId)
      .like("dedupe_key", "ref:snaptrade%");

    // Coinbase (and any crypto-typed position) is priced as SYMBOL-USD, not as a US equity.
    const brokerIsCrypto = /coinbase/i.test(account.brokerageName);

    const rows: {
      portfolio_id: string; instrument_id: string; type: string;
      quantity: number; price: number; fees: number; currency: string;
      executed_at: string; dedupe_key: string;
    }[] = [];
    // Collect price rows and upsert them in ONE call per account instead of one round-trip each.
    const priceRows: { instrument_id: string; price: number; currency: string; as_of: string }[] = [];

    for (const pos of positions) {
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
      // Synthetic opening buy at the per-share cost basis (falls back to price if cost is missing).
      const price = pos.avgCost ?? pos.price ?? 0;
      rows.push({
        portfolio_id: portfolioId, instrument_id: inst.id, type: "buy",
        quantity: pos.units, price, fees: 0, currency, executed_at: today,
        dedupe_key: transactionDedupeKey({
          ref: `snaptrade-pos:${account.id}:${symbol}`, type: "buy",
          instrument_id: inst.id, executed_at: today, quantity: pos.units, price, fees: 0,
        }),
      });
      if (pos.price != null) priceRows.push({ instrument_id: inst.id, price: pos.price, currency, as_of: now });
    }

    if (priceRows.length) await admin.from("price_cache").upsert(priceRows);
    if (rows.length) await admin.from("transactions").insert(rows);
    holdings += rows.length;

    // --- Options: import into the options ledger, kept separate from the equity snapshot above ---
    const acctLabel = account.label || account.brokerageName || account.id.slice(0, 6);

    // The activities feed (full transaction history) is the source of truth when available: it
    // records opens AND closes, so the option_positions view derives current open contracts from
    // it correctly. The positions feed is a FALLBACK for connections whose activities are empty —
    // running both would double-count every open position (its opening trade + its live snapshot).
    let activitiesHaveOptions = false;
    if (provider.getOptionActivities) {
      const act = await provider.getOptionActivities(account.id);
      const ts = account.txnSync;
      const tsNote = ts ? ` {txnSync: initialDone=${ts.initialDone}, firstTxn=${ts.firstDate ?? "none"}}` : "";
      debug.push(
        act.error
          ? `${acctLabel}: activities error — ${act.error}`
          : `${acctLabel}: ${act.scanned} activities, ${act.optionRows} option, ${act.legs.length} imported${act.scanned === 0 && act.shape ? ` [resp: ${act.shape}]` : ""}${tsNote}`
      );
      activitiesHaveOptions = act.optionRows > 0;
      // Accumulate: option history is never deleted, so a 2025 trade stays even in 2030.
      optionLegs += await importOptionLegs(portfolioId, act.legs, "snaptrade-act", "accumulate");
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
    const settled = await Promise.all(accounts.slice(i, i + ACCOUNT_BATCH).map(processAccount));
    for (const r of settled) {
      holdings += r.holdings;
      optionLegs += r.optionLegs;
      optionDebug.push(...r.debug);
    }
  }

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

  revalidatePath("/dashboard");
  revalidatePath("/dashboard/broker");
  revalidatePath("/dashboard/options");
  return {
    ok: true, accounts: accounts.length, holdings, options: optionLegs,
    debug: optionDebug.length ? optionDebug.join(" · ") : undefined,
  };
}
