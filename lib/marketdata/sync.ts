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
  getProvider,
  providerSupportsOptions,
} from "@/lib/marketdata";
import { inferDivFrequency } from "@/lib/dividends/cadence";
import { splitFactor, type Split } from "@/lib/corporate/splits";

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
  // price_history stores split-adjusted (today's-shares) closes. A provider whose feed is as-traded
  // gets the shared provider splits applied here — the sync writes instrument_splits just before
  // this runs — so a pre-split $1,200 close lands as the $120 it is in today's shares.
  let adjust: (close: number, date: string) => number = (close) => close;
  if (!getProvider().capabilities.priceHistorySplitAdjusted) {
    const { data } = await admin
      .from("instrument_splits").select("ex_date, ratio").eq("instrument_id", instrumentId);
    const splits: Split[] = (data ?? [])
      .filter((r: { ex_date: string | null; ratio: number | null }) => r.ex_date && r.ratio != null)
      .map((r: { ex_date: string | null; ratio: number | null }) => ({ exDate: r.ex_date as string, ratio: Number(r.ratio) }))
      .sort((a: Split, b: Split) => a.exDate.localeCompare(b.exDate));
    if (splits.length) adjust = (close, date) => close / splitFactor(splits, date);
  }
  for (let i = 0; i < history.length; i += 500) {
    await admin.from("price_history").upsert(
      history.slice(i, i + 500).map((h) => ({ instrument_id: instrumentId, d: h.date, close: adjust(h.close, h.date) })),
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
): Promise<number | null> {
  const splits = await getSplitHistory(symbol, exchange);
  if (!splits.length) return 0;
  const { error } = await admin.from("instrument_splits").upsert(
    splits.map((s) => ({
      instrument_id: instrumentId,
      ex_date: s.exDate,
      ratio: s.ratio,
      source: "provider",
    })),
    { onConflict: "instrument_id,ex_date" }
  );
  if (error) {
    // Deliberately does NOT fail the instrument: its quote, dividends and price history are
    // already stored and are worth keeping. But it must not vanish either — an unwritten split
    // silently misstates cost basis, and the first run after this feature shipped fetched every
    // symbol's splits and stored none of them (the table did not exist yet) while the summary
    // reported a clean night. null means "fetched, not stored"; the caller counts it.
    console.error(`[cron:sync] splits ${symbol}.${exchange} not stored:`, error.message);
    return null;
  }
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
    patch.div_frequency = inferDivFrequency(history);
    patch.next_dividend_per_share = history[history.length - 1].amount;
    // Trailing twelve months of payouts. When the cadence is known, that is the last `freq`
    // payments, not "everything inside a 366-day window": a quarterly payer whose ex-dates fall
    // just inside both ends of the window returns FIVE payments, overstating the annual figure by
    // 25% for the distribution ETFs that rely on it (no forward rate from the provider).
    const freqKnown = patch.div_frequency as number | null;
    const now = Date.now();
    const withinYear = history.filter((h) => now - new Date(h.exDate).getTime() < 366 * 24 * 60 * 60 * 1000);
    const last12 = freqKnown && freqKnown > 0 && withinYear.length > freqKnown ? withinYear.slice(-freqKnown) : withinYear;
    ttmSum = last12.reduce((s, h) => s + (h.amount || 0), 0);
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
  } else if (history.length) {
    // A name that used to pay and has paid nothing for a year, with no forward rate, has
    // suspended its dividend. Leaving the column untouched kept projecting the old payout into
    // "Dividends / yr" and the calendar forever; zero is the honest figure.
    annual = 0;
  } else {
    annual = forward;
  }
  if (annual != null) patch.annual_div_per_share = annual;

  if (Object.keys(patch).length) {
    await admin.from("instruments").update(patch).eq("id", instrumentId);
  }
}

// Refresh a single instrument's cached quote (price + day change). Returns whether a price was
// actually written: the nightly sync counts these, because a provider outage that returns nothing
// looks identical to a clean night otherwise (every method degrades to null rather than throwing).
export async function syncInstrumentQuote(
  admin: Admin,
  instrumentId: string,
  symbol: string,
  exchange: string,
  currency?: string
): Promise<boolean> {
  const q = await getQuote(symbol, exchange, currency);
  if (q.price == null) return false;
  const { error } = await admin.from("price_cache").upsert({
    instrument_id: instrumentId,
    price: q.price,
    change_pct: q.changePct,
    currency: q.currency ?? currency ?? null,
    as_of: quoteAsOf(q.asOf),
  });
  return !error;
}

// "Prices as of" is the market's timestamp when the provider gives one, never later than now, and
// the fetch time only as a fallback. A price fetched on Sunday is Friday's close, and the label
// should say so instead of "2 hours ago".
export function quoteAsOf(asOf: string | null | undefined): string {
  const now = Date.now();
  if (asOf) {
    const t = Date.parse(asOf);
    if (Number.isFinite(t) && t > 0 && t <= now) return new Date(t).toISOString();
  }
  return new Date(now).toISOString();
}
