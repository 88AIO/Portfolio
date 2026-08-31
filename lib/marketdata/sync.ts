// Server-side market-data sync helpers (service role). Shared by the manual add/import paths and
// the nightly cron. The user-facing "Refresh prices" only touches quotes (fast); the heavier
// dividend + price-history sync runs from the cron — matching the project brief's model where the
// app reads cached tables and only the scheduled sync fans out to a provider.
import type { createAdminClient } from "@/lib/supabase/admin";
import {
  getDividendInfo,
  getDividendHistory,
  getPriceHistory,
  getSplitHistory,
  getQuote,
  getOptionChain,
  providerSupportsOptions,
} from "@/lib/marketdata";
import { inferDivFrequency } from "@/lib/dividends/cadence";

type Admin = ReturnType<typeof createAdminClient>;

// Capture one daily implied-volatility sample for a name, so the O3 put finder can rank today's
// IV against its own trailing range. We store the near-the-money put's IV at ~`targetDte` days —
// a stable reference point (see finder-actions.ts, which stores the same measurement on scan).
// Keyed by symbol/exchange so names the user doesn't hold yet still accrue history.
export async function syncIvSample(
  admin: Admin,
  symbol: string,
  exchange: string,
  targetDte = 35
): Promise<boolean> {
  // No chains from this provider means no IV to sample — bail before the call rather than logging
  // a failure per symbol per night.
  if (!providerSupportsOptions()) return false;
  const base = await getOptionChain(symbol, exchange);
  if (!base) return false;
  const now = Date.now();
  const dteOf = (iso: string) => (new Date(`${iso}T00:00:00Z`).getTime() - now) / 86_400_000;

  // Choose the listed expiration nearest the target DTE.
  const exps = base.expirations.length ? base.expirations : base.expiration ? [base.expiration] : [];
  let bestExp: string | null = null;
  let bestDiff = Infinity;
  for (const e of exps) {
    const d = Math.abs(dteOf(e) - targetDte);
    if (dteOf(e) > 0 && d < bestDiff) { bestDiff = d; bestExp = e; }
  }
  if (!bestExp) return false;

  const contracts =
    base.expiration === bestExp ? base.contracts : (await getOptionChain(symbol, exchange, bestExp))?.contracts ?? [];
  const q = await getQuote(symbol, exchange);
  const price = q.price;
  const puts = contracts.filter((c) => c.type === "put" && c.iv != null && (price == null || c.strike <= price));
  if (!puts.length || price == null) return false;
  const atm = puts.sort((a, b) => Math.abs(a.strike - price) - Math.abs(b.strike - price))[0];
  if (atm.iv == null) return false;

  const captured_on = new Date().toISOString().slice(0, 10);
  await admin.from("iv_history").upsert(
    { symbol: symbol.toUpperCase(), exchange, captured_on, iv: atm.iv * 100 },
    { onConflict: "symbol,exchange,captured_on" }
  );
  return true;
}

// Backfill weekly closes for an instrument, so the performance chart can draw value-over-time from
// cached data. Defaults to ~13 months (the nightly window); pass a larger fromDays for a one-time
// deep backfill (e.g. to a portfolio's inception). Upsert is idempotent on (instrument_id, d).
export async function syncInstrumentPriceHistory(
  admin: Admin,
  instrumentId: string,
  symbol: string,
  exchange: string,
  fromDays = 400,
  currency?: string | null
) {
  const history = await getPriceHistory(symbol, exchange, fromDays, currency);
  if (!history.length) return;
  for (let i = 0; i < history.length; i += 500) {
    await admin.from("price_history").upsert(
      history.slice(i, i + 500).map((h) => ({ instrument_id: instrumentId, d: h.date, close: h.close })),
      { onConflict: "instrument_id,d" }
    );
  }
}

// Sync an instrument's share splits.
//
// Written once and then left alone: a split that happened is a fact about the past, so rows are
// upserted on (instrument_id, ex_date) and old ones are never deleted. Deleting on a provider's
// empty response would be the dangerous move — a bad day at the vendor would silently un-split
// every holding and restate everyone's cost basis.
export async function syncInstrumentSplits(
  admin: Admin,
  instrumentId: string,
  symbol: string,
  exchange: string
) {
  const splits = await getSplitHistory(symbol, exchange);
  if (!splits.length) return 0;
  await admin.from("instrument_splits").upsert(
    splits.map((s) => ({
      instrument_id: instrumentId,
      ex_date: s.exDate,
      ratio: s.ratio,
      source: "provider",
    })),
    { onConflict: "instrument_id,ex_date" }
  );
  return splits.length;
}

// Sync an instrument's dividend reference + history from the market-data provider.
export async function syncInstrumentDividends(
  admin: Admin,
  instrumentId: string,
  symbol: string,
  exchange: string,
  currency: string
) {
  const [info, history] = await Promise.all([
    getDividendInfo(symbol, exchange),
    getDividendHistory(symbol, exchange),
  ]);
  const patch: Record<string, unknown> = {};
  if (info) {
    patch.div_yield_ttm = info.yieldTtm;
    patch.ex_dividend_date = info.exDividendDate;
    patch.next_dividend_date = info.nextDividendDate;
  }

  let ttmSum = 0;
  if (history.length) {
    await admin.from("dividends").upsert(
      history.map((h) => ({ instrument_id: instrumentId, ex_date: h.exDate, amount: h.amount, currency })),
      { onConflict: "instrument_id,ex_date" }
    );
    const now = Date.now();
    const last12 = history.filter((h) => now - new Date(h.exDate).getTime() < 366 * 24 * 60 * 60 * 1000);
    ttmSum = last12.reduce((s, h) => s + (h.amount || 0), 0);
    patch.div_frequency = inferDivFrequency(history);
    patch.next_dividend_per_share = history[history.length - 1].amount;
  }

  // Annual dividend per share — honest, forward-looking, and never inflated across a cut:
  //  • Prefer Yahoo's forward "dividendRate" when present — it already reflects announced changes.
  //  • Otherwise use the trailing-12-month actual (always populated for distribution ETFs like
  //    SCHD/JEPQ/QYLD where the forward rate is missing) — BUT if the most recent payment run-rate
  //    has dropped materially below TTM (a cut), use the lower run-rate so we don't cling to the
  //    stale pre-cut figure. We no longer take max(forward, ttm), which biased income upward.
  const forward = info?.annualDividendPerShare ?? null;
  const freq = (patch.div_frequency as number | null) ?? null;
  const lastPayment = history.length ? history[history.length - 1].amount : 0;
  const recentRunRate = freq && lastPayment > 0 ? lastPayment * freq : 0;
  let annual: number | null;
  if (forward && forward > 0) {
    annual = forward;
  } else if (ttmSum > 0) {
    annual = recentRunRate > 0 && recentRunRate < ttmSum * 0.8 ? recentRunRate : ttmSum;
  } else {
    annual = forward;
  }
  if (annual != null) patch.annual_div_per_share = annual;

  if (Object.keys(patch).length) {
    await admin.from("instruments").update(patch).eq("id", instrumentId);
  }
}

// Refresh a single instrument's cached quote (price + day change).
export async function syncInstrumentQuote(
  admin: Admin,
  instrumentId: string,
  symbol: string,
  exchange: string,
  currency?: string
) {
  const q = await getQuote(symbol, exchange, currency);
  if (q.price != null) {
    await admin.from("price_cache").upsert({
      instrument_id: instrumentId,
      price: q.price,
      change_pct: q.changePct,
      currency: q.currency ?? currency ?? null,
      as_of: new Date().toISOString(),
    });
  }
}
