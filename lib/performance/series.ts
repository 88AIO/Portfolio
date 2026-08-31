// Portfolio performance series — reconstructs value-over-time and net-invested-over-time from
// the transaction ledger (source of truth) plus cached weekly closing prices. No stored
// snapshots: every point is recomputed, so history stays correct after edits or back-dated trades.
//
// Two honest lines:
//   • Value    — shares held on each date × that date's close, summed in the base currency.
//   • Invested — cumulative net cash put into securities (buys − sell proceeds) up to that date.
// The gap between them is capital appreciation; dividends are tracked separately elsewhere.

import { splitFactor, type Split } from "@/lib/corporate/splits";

export type PerfTransaction = {
  instrument_id: string;
  type: string; // buy | sell | dividend | deposit | withdrawal
  quantity: number;
  price: number;
  fees: number;
  currency: string;
  executed_at: string; // YYYY-MM-DD
};

export type PerfClose = { date: string; close: number };

export type PerfPoint = { date: string; value: number; invested: number };

export type PerformanceSeries = {
  points: PerfPoint[];
  startValue: number;
  endValue: number;
  endInvested: number;
  // Return over the window on the money actually deployed (simple, not time-weighted — honest label).
  gain: number; // endValue - endInvested
  // null when there is no positive deployed capital left to compute a return against (a fully
  // exited position leaves net invested at or below zero). Reporting 0% there would be a
  // confident wrong number sitting next to a real gain figure.
  gainPct: number | null;
};

/** Cumulative shares held on each transaction date, for one instrument (dates ascending). */
type ShareStep = { date: string; shares: number };

function buildShareTimeline(txs: PerfTransaction[], splits?: Split[]): ShareStep[] {
  const sorted = [...txs].sort((a, b) => a.executed_at.localeCompare(b.executed_at));
  const steps: ShareStep[] = [];
  let shares = 0;
  for (const t of sorted) {
    // Every share count here is expressed in TODAY'S shares, because the closes it will be
    // multiplied against are split-adjusted (price_history stores the provider's adjusted close —
    // see providers/yahoo.ts). Mixing an unadjusted share count with an adjusted price is the
    // classic way to draw a chart that falls off a cliff on the split date and never recovers.
    const qty = t.quantity * splitFactor(splits, t.executed_at);
    if (t.type === "buy") shares += qty;
    else if (t.type === "sell") shares -= qty;
    else continue; // dividends / cash movements don't change share count
    const last = steps[steps.length - 1];
    if (last && last.date === t.executed_at) last.shares = shares;
    else steps.push({ date: t.executed_at, shares });
  }
  return steps;
}

/** Shares held as of `date` (the last step on or before it). */
function sharesAsOf(steps: ShareStep[], date: string): number {
  let held = 0;
  for (const s of steps) {
    if (s.date <= date) held = s.shares;
    else break;
  }
  return held;
}

/** Forward-filled close on or before `date` (null until the first known close). */
function closeAsOf(closes: PerfClose[], date: string): number | null {
  let val: number | null = null;
  for (const c of closes) {
    if (c.date <= date) val = c.close;
    else break;
  }
  return val;
}

export type BacktestPoint = { date: string; value: number };

/**
 * "Growth of current holdings" backtest — value-over-time computed from the shares you hold NOW,
 * priced back through the weekly-close history. Used when the ledger has no real trade dates (e.g.
 * broker holdings synced as a single current snapshot), so a true historical reconstruction would
 * wrongly show "held nothing until today". This is an honest what-if — the basket you hold today,
 * valued over the past year — NOT your actual historical portfolio value.
 * @param holdings          current holdings (instrument_id, shares, price currency)
 * @param historyById       instrument_id → ascending weekly closes
 * @param currentValueById  optional live base-currency value per instrument, for the final point
 */
export function buildHoldingsBacktest(
  holdings: { instrument_id: string; shares: number; currency: string }[],
  historyById: Map<string, PerfClose[]>,
  fx: (currency: string) => number,
  today: string,
  currentValueById?: Map<string, number>
): { points: BacktestPoint[]; startValue: number; endValue: number } {
  const gridSet = new Set<string>();
  for (const h of holdings) {
    const closes = historyById.get(h.instrument_id);
    if (closes) for (const c of closes) if (c.date <= today) gridSet.add(c.date);
  }
  gridSet.add(today);
  const grid = [...gridSet].sort();

  const points: BacktestPoint[] = [];
  for (const date of grid) {
    let value = 0;
    for (const h of holdings) {
      if (!h.shares) continue;
      if (date === today && currentValueById?.has(h.instrument_id)) {
        value += currentValueById.get(h.instrument_id) ?? 0;
        continue;
      }
      const close = closeAsOf(historyById.get(h.instrument_id) ?? [], date);
      if (close == null) continue;
      value += h.shares * close * fx(h.currency);
    }
    points.push({ date, value });
  }
  return { points, startValue: points[0]?.value ?? 0, endValue: points[points.length - 1]?.value ?? 0 };
}

/**
 * Dollar-for-dollar S&P 500 benchmark: the same cash you actually deployed (each buy minus each
 * sell, on the date it happened) invested into SPY instead. Answers "did my picks beat just buying
 * the index with the same money at the same times?" Returns date → benchmark value (base currency).
 * @param txs         your buys/sells (the cash flows); other types ignored
 * @param benchCloses SPY weekly closes, ascending, in the base currency
 * @param fx          currency → base multiplier (applied to your cash flows)
 * @param dates       the dates to value the benchmark on (use the same grid as your value line)
 */
export function buildBenchmarkSeries(
  txs: PerfTransaction[],
  benchCloses: PerfClose[],
  fx: (currency: string) => number,
  dates: string[],
): Map<string, number> {
  const flows = txs
    .filter((t) => t.type === "buy" || t.type === "sell")
    .sort((a, b) => a.executed_at.localeCompare(b.executed_at));

  // Accumulate equivalent SPY shares: a buy of $X buys X/price_SPY shares that day; a sell redeems.
  const steps: ShareStep[] = [];
  let spyShares = 0;
  for (const t of flows) {
    const close = closeAsOf(benchCloses, t.executed_at);
    if (!close || close <= 0) continue; // no SPY price yet on/before this date
    const r = fx(t.currency);
    const cash = t.type === "buy" ? t.quantity * t.price + t.fees : t.quantity * t.price - t.fees;
    spyShares += (t.type === "buy" ? 1 : -1) * (cash * r) / close;
    const last = steps[steps.length - 1];
    if (last && last.date === t.executed_at) last.shares = spyShares;
    else steps.push({ date: t.executed_at, shares: spyShares });
  }

  const out = new Map<string, number>();
  for (const date of dates) {
    const shares = sharesAsOf(steps, date);
    const close = closeAsOf(benchCloses, date);
    out.set(date, shares > 0 && close ? shares * close : 0);
  }
  return out;
}

/**
 * Build the performance series.
 * @param txs           all of the user's transactions (any instrument)
 * @param historyById   instrument_id → ascending weekly closes
 * @param currencyById  instrument_id → the instrument's price currency
 * @param fx            currency → base-currency multiplier
 * @param today         YYYY-MM-DD, appended as the final point
 * @param currentValueById optional live value (base currency) per instrument for the final point
 */
export function buildPerformanceSeries(
  txs: PerfTransaction[],
  historyById: Map<string, PerfClose[]>,
  currencyById: Map<string, string>,
  fx: (currency: string) => number,
  today: string,
  currentValueById?: Map<string, number>,
  splitsById?: Map<string, Split[]>
): PerformanceSeries {
  const instrumentIds = [...new Set(txs.map((t) => t.instrument_id))];

  // Per-instrument share timelines.
  const stepsById = new Map<string, ShareStep[]>();
  for (const id of instrumentIds) {
    stepsById.set(id, buildShareTimeline(txs.filter((t) => t.instrument_id === id), splitsById?.get(id)));
  }

  // Date grid: every distinct weekly-close date we have, from the first transaction onward, + today.
  const firstTx = txs.reduce((min, t) => (t.executed_at < min ? t.executed_at : min), today);
  const gridSet = new Set<string>();
  for (const closes of historyById.values()) {
    for (const c of closes) if (c.date >= firstTx && c.date <= today) gridSet.add(c.date);
  }
  gridSet.add(today);
  const grid = [...gridSet].sort();

  const points: PerfPoint[] = [];
  for (const date of grid) {
    let value = 0;
    for (const id of instrumentIds) {
      const shares = sharesAsOf(stepsById.get(id) ?? [], date);
      if (shares === 0) continue;
      if (date === today && currentValueById?.has(id)) {
        // Use the live cached value for the final point so the chart ends on today's real number.
        // currentValueById already holds base-currency total value for the current share count.
        value += currentValueById.get(id) ?? 0;
        continue;
      }
      const close = closeAsOf(historyById.get(id) ?? [], date);
      if (close == null) continue;
      value += shares * close * fx(currencyById.get(id) ?? "USD");
    }

    let invested = 0;
    for (const t of txs) {
      if (t.executed_at > date) continue;
      const r = fx(t.currency);
      if (t.type === "buy") invested += (t.quantity * t.price + t.fees) * r;
      else if (t.type === "sell") invested -= (t.quantity * t.price - t.fees) * r;
    }

    // Deliberately NOT clamped at zero. Once you have taken more cash out than you put in, net
    // invested is genuinely negative, and clamping it collapses `gain` (value - invested) to zero:
    // someone who bought for 1,000 and sold for 1,500 would be told they made nothing.
    points.push({ date, value, invested });
  }

  const start = points[0];
  const end = points[points.length - 1];
  const endValue = end?.value ?? 0;
  const endInvested = end?.invested ?? 0;
  const gain = endValue - endInvested;

  return {
    points,
    startValue: start?.value ?? 0,
    endValue,
    endInvested,
    gain,
    gainPct: endInvested > 0 ? (gain / endInvested) * 100 : null,
  };
}
