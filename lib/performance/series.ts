// Portfolio performance series — reconstructs value-over-time and net-invested-over-time from
// the transaction ledger (source of truth) plus cached weekly closing prices. No stored
// snapshots: every point is recomputed, so history stays correct after edits or back-dated trades.
//
// Two honest lines:
//   • Value    — shares held on each date × that date's close, summed in the base currency.
//   • Invested — cumulative net cash put into securities (buys − sell proceeds) up to that date.
// The gap between them is capital appreciation; dividends are tracked separately elsewhere.

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
  gainPct: number;
};

/** Cumulative shares held on each transaction date, for one instrument (dates ascending). */
type ShareStep = { date: string; shares: number };

function buildShareTimeline(txs: PerfTransaction[]): ShareStep[] {
  const sorted = [...txs].sort((a, b) => a.executed_at.localeCompare(b.executed_at));
  const steps: ShareStep[] = [];
  let shares = 0;
  for (const t of sorted) {
    if (t.type === "buy") shares += t.quantity;
    else if (t.type === "sell") shares -= t.quantity;
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
  currentValueById?: Map<string, number>
): PerformanceSeries {
  const instrumentIds = [...new Set(txs.map((t) => t.instrument_id))];

  // Per-instrument share timelines.
  const stepsById = new Map<string, ShareStep[]>();
  for (const id of instrumentIds) {
    stepsById.set(id, buildShareTimeline(txs.filter((t) => t.instrument_id === id)));
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

    points.push({ date, value, invested: Math.max(0, invested) });
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
    gainPct: endInvested > 0 ? (gain / endInvested) * 100 : 0,
  };
}
