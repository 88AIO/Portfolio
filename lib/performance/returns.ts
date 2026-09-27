// The return figures the performance page compares against the S&P 500, computed the way brokers,
// fund managers and index providers quote them:
//
//   • Time-weighted return (TWR). How the investments themselves performed, with the timing and
//     size of your deposits and withdrawals taken out, so it can be compared with an index. Each
//     week between valuations is one sub-period (Modified Dietz: flows weighted by how long they
//     were invested), and the sub-period returns are chain-linked.
//   • Money-weighted return (XIRR). What YOUR cash actually earned, given when you added and took
//     it out: the annual rate that discounts every flow and today's value to zero.
//   • A total-return index for the benchmark: SPY with every dividend reinvested on its ex-date,
//     which is how the S&P 500's own returns are published.
//
// Dividends count as return on both sides. A dividend portfolio compared on price alone is short
// its income; the index compared on price alone is short about 1.3 points a year.

import {
  buildShareTimeline,
  closeAsOf,
  type PerfClose,
  type PerfTransaction,
  type ShareStep,
} from "./series";
import type { Split } from "@/lib/corporate/splits";
import { isBrokerRestated } from "@/lib/brokersync/restated";

const DAY_MS = 86_400_000;
const daysBetween = (a: string, b: string) => (Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY_MS;
const dayBefore = (d: string) => new Date(Date.parse(`${d}T00:00:00Z`) - DAY_MS).toISOString().slice(0, 10);

export type CashFlow = { date: string; amount: number };
export type Dividend = { exDate: string; amount: number };

/**
 * What an opening-balance lot was worth on the day it appears, or null when no price exists then.
 *
 * The broker feed only reaches back so far, so the sync adds one lot per holding for the shares
 * bought before its window, dated at the window's start but priced at the old average cost
 * (lib/brokersync/restated.ts). Counted at cost, every gain made before that date — years of it,
 * for a long-held stock — lands as return in the first weeks after it. Performance measurement
 * treats such a lot as a transfer in at market value on its date, which is what this returns.
 */
export function openingLotValuer(
  historyById: Map<string, PerfClose[]>,
  fx: (currency: string) => number,
): (t: PerfTransaction) => number | null {
  return (t) => {
    if (t.type !== "buy" || !isBrokerRestated(t.dedupe_key)) return null;
    const close = closeAsOf(historyById.get(t.instrument_id) ?? [], t.executed_at);
    return close != null && close > 0 ? t.quantity * close * fx(t.currency) : null;
  };
}

/**
 * Money-weighted return: the annual rate r with Σ amount / (1+r)^(days/365) = 0 (Excel's XIRR).
 * Investor's sign convention: money put in is negative; money taken out — sales, dividends, and
 * what the holdings are worth at the end — is positive. null without both signs or a solution.
 * Solved by bracketing and bisection rather than Newton: slower by microseconds, but it cannot
 * wander off to a meaningless root on a long, lumpy history.
 */
export function xirr(flows: CashFlow[]): number | null {
  const fs = flows
    .filter((f) => Number.isFinite(f.amount) && f.amount !== 0)
    .sort((a, b) => a.date.localeCompare(b.date));
  if (fs.length < 2 || !fs.some((f) => f.amount < 0) || !fs.some((f) => f.amount > 0)) return null;
  const t = fs.map((f) => daysBetween(fs[0].date, f.date) / 365);
  const npv = (r: number) => fs.reduce((s, f, i) => s + f.amount / Math.pow(1 + r, t[i]), 0);
  let lo = -0.9999;
  let hi = 1;
  let fLo = npv(lo);
  let fHi = npv(hi);
  while (fLo * fHi > 0 && hi < 1e6) {
    hi *= 4;
    fHi = npv(hi);
  }
  if (!Number.isFinite(fLo) || !Number.isFinite(fHi) || fLo * fHi > 0) return null;
  for (let i = 0; i < 300 && hi - lo > 1e-12; i++) {
    const mid = (lo + hi) / 2;
    const fMid = npv(mid);
    if (fMid === 0) return mid;
    if (fLo * fMid < 0) hi = mid;
    else {
      lo = mid;
      fLo = fMid;
    }
  }
  return (lo + hi) / 2;
}

/** A cumulative return over `days`, as an annual rate. null under a year: annualizing a few
 * weeks turns noise into headlines, so short windows are shown as they are. */
export function annualize(total: number | null, days: number): number | null {
  if (total == null || !Number.isFinite(total) || total <= -1 || days < 365) return null;
  return Math.pow(1 + total, 365 / days) - 1;
}

/**
 * Growth of one share of the benchmark with every dividend reinvested at the close on or before
 * its ex-date. Only ratios of this series mean anything (index(b) / index(a) − 1 is the total
 * return from a to b).
 */
export function totalReturnIndex(closes: PerfClose[], dividends: Dividend[]): PerfClose[] {
  const divs = [...dividends].sort((a, b) => a.exDate.localeCompare(b.exDate));
  const out: PerfClose[] = [];
  let units = 1;
  let j = 0;
  // Skip payouts from before the series starts; they belong to nobody here.
  while (j < divs.length && closes.length && divs[j].exDate <= closes[0].date) j++;
  for (const c of closes) {
    while (j < divs.length && divs[j].exDate <= c.date) {
      const px = closeAsOf(closes, divs[j].exDate);
      if (px && px > 0) units += (units * divs[j].amount) / px;
      j++;
    }
    out.push({ date: c.date, close: units * c.close });
  }
  return out;
}

/** Return of a price or index series between two dates (forward-filled). */
export function seriesReturn(series: PerfClose[], from: string, to: string): number | null {
  const a = closeAsOf(series, from);
  const b = closeAsOf(series, to);
  return a && b && a > 0 ? b / a - 1 : null;
}

/**
 * Whether a dividend history reaches back far enough to reinvest every payout since `from`.
 * Quarterly payers leave at most ~3 months between payouts, so the first one on record must fall
 * within ~100 days of the window's start.
 */
export function dividendsCover(dividends: Dividend[], from: string | null): boolean {
  if (!from) return false;
  const first = dividends.reduce<string | null>((m, d) => (!m || d.exDate < m ? d.exDate : m), null);
  return first != null && daysBetween(from, first) <= 100;
}

export type TwrResult = {
  /** Growth of 1 on each valuation date; ratios between dates are the TWR for that window. */
  points: PerfClose[];
  start: string | null;
  end: string | null;
  /** Cumulative TWR over the whole window. */
  total: number | null;
  /** Today's value of holdings with no price history at all, left out of the TWR. */
  unpricedValue: number;
  /** Weekly sub-periods discarded as implausible (a data error, not a market move). */
  discardedPeriods: number;
};

/**
 * Time-weighted return over the ledger, valued on every weekly close (and today).
 *
 * An instrument joins the calculation on its first stored close. Before that it can't be valued,
 * and counting its cost as invested while valuing it at nothing would book years of gains as one
 * fake jump on the day its price history starts. So the shares held then enter as a contribution
 * at that first close, and only what happens after is performance. Holdings never priced at all
 * are left out and reported (unpricedValue) rather than guessed.
 */
export function timeWeightedReturn(opts: {
  txs: PerfTransaction[];
  historyById: Map<string, PerfClose[]>;
  currencyById: Map<string, string>;
  fx: (currency: string) => number;
  today: string;
  currentValueById?: Map<string, number>;
  splitsById?: Map<string, Split[]>;
  includeDividends: boolean;
}): TwrResult {
  const { txs, historyById, currencyById, fx, today, currentValueById, splitsById, includeDividends } = opts;
  const empty: TwrResult = { points: [], start: null, end: null, total: null, unpricedValue: 0, discardedPeriods: 0 };
  const openingLot = openingLotValuer(historyById, fx);

  type Inst = { id: string; closes: PerfClose[]; steps: ShareStep[]; firstClose: string; rate: number };
  const insts: Inst[] = [];
  let unpricedValue = 0;
  const flows: CashFlow[] = []; // + money into the investments, − money out
  const income: CashFlow[] = [];

  for (const id of new Set(txs.map((t) => t.instrument_id))) {
    const closes = (historyById.get(id) ?? []).filter((c) => c.date <= today);
    const own = txs.filter((t) => t.instrument_id === id);
    const steps = buildShareTimeline(own, splitsById?.get(id));
    if (!closes.length) {
      if ((steps[steps.length - 1]?.shares ?? 0) !== 0) unpricedValue += currentValueById?.get(id) ?? 0;
      continue;
    }
    const firstClose = closes[0].date;
    const rate = fx(currencyById.get(id) ?? "USD");
    insts.push({ id, closes, steps, firstClose, rate });

    // Shares already held when the first price appears come in as one contribution at that price.
    const before = dayBefore(firstClose);
    let held = 0;
    for (const s of steps) if (s.date <= before) held = s.shares;
    if (held !== 0) flows.push({ date: firstClose, amount: held * closes[0].close * rate });

    for (const t of own) {
      if (t.executed_at < firstClose) continue;
      const r = fx(t.currency);
      const atMarket = openingLot(t);
      if (atMarket != null) flows.push({ date: t.executed_at, amount: atMarket });
      else if (t.type === "buy") flows.push({ date: t.executed_at, amount: (t.quantity * t.price + t.fees) * r });
      else if (t.type === "sell") flows.push({ date: t.executed_at, amount: -(t.quantity * t.price - t.fees) * r });
      else if (t.type === "dividend" && includeDividends) income.push({ date: t.executed_at, amount: t.quantity * t.price * r });
    }
  }
  if (!insts.length) return { ...empty, unpricedValue };

  // Valuation dates: every stored close from the first priced trade on, plus today.
  const firstFlow = flows.reduce<string | null>((m, f) => (!m || f.date < m ? f.date : m), null);
  if (!firstFlow) return { ...empty, unpricedValue };
  const gridSet = new Set<string>([today]);
  for (const i of insts) for (const c of i.closes) if (c.date >= firstFlow) gridSet.add(c.date);
  const grid = [...gridSet].filter((d) => d <= today).sort();

  // Walk every instrument's shares and closes forward with the grid (one pass, no rescans).
  const cursor = insts.map(() => ({ c: -1, s: -1 }));
  const valueAt = (d: string) => {
    let v = 0;
    insts.forEach((i, k) => {
      const cur = cursor[k];
      while (cur.c + 1 < i.closes.length && i.closes[cur.c + 1].date <= d) cur.c++;
      while (cur.s + 1 < i.steps.length && i.steps[cur.s + 1].date <= d) cur.s++;
      if (d < i.firstClose) return;
      if (d === today && currentValueById?.has(i.id)) {
        v += currentValueById.get(i.id) ?? 0;
        return;
      }
      const shares = cur.s >= 0 ? i.steps[cur.s].shares : 0;
      if (shares !== 0 && cur.c >= 0) v += shares * i.closes[cur.c].close * i.rate;
    });
    return v;
  };

  flows.sort((a, b) => a.date.localeCompare(b.date));
  income.sort((a, b) => a.date.localeCompare(b.date));
  let fi = 0;
  let ii = 0;
  // Flows dated before the first valuation are already inside its value.
  while (fi < flows.length && flows[fi].date <= grid[0]) fi++;
  while (ii < income.length && income[ii].date <= grid[0]) ii++;

  let index = 1;
  let discardedPeriods = 0;
  let v0 = valueAt(grid[0]);
  const points: PerfClose[] = [{ date: grid[0], close: 1 }];
  for (let k = 1; k < grid.length; k++) {
    const d0 = grid[k - 1];
    const d1 = grid[k];
    const span = daysBetween(d0, d1);
    let cf = 0;
    let weighted = 0;
    while (fi < flows.length && flows[fi].date <= d1) {
      cf += flows[fi].amount;
      weighted += flows[fi].amount * (span > 0 ? daysBetween(flows[fi].date, d1) / span : 0);
      fi++;
    }
    let inc = 0;
    while (ii < income.length && income[ii].date <= d1) inc += income[ii++].amount;
    const v1 = valueAt(d1);
    const base = v0 + weighted;
    let r = 0;
    if (base > 1e-6 * Math.max(1, Math.abs(v1), Math.abs(v0))) {
      r = (v1 - v0 - cf + inc) / base;
      // A whole portfolio does not lose 95% or quadruple in a week; that is a bad price, and
      // chain-linking it would poison every figure after it.
      if (!Number.isFinite(r) || r < -0.95 || r > 3) {
        discardedPeriods++;
        r = 0;
      }
    }
    index *= 1 + r;
    points.push({ date: d1, close: index });
    v0 = v1;
  }

  return {
    points,
    start: grid[0],
    end: grid[grid.length - 1],
    total: points.length > 1 ? index - 1 : null,
    unpricedValue,
    discardedPeriods,
  };
}

/**
 * The investor's own cash flows for XIRR: buys in (negative), sales out (positive), dividends out
 * (positive, when counted), and `endValue` as if sold on `today`. With `openingLot`, a broker's
 * opening-balance lot goes in at its market value that day instead of its old cost.
 */
export function investorFlows(
  txs: PerfTransaction[],
  fx: (currency: string) => number,
  today: string,
  endValue: number,
  includeDividends: boolean,
  openingLot?: (t: PerfTransaction) => number | null,
): CashFlow[] {
  const out: CashFlow[] = [];
  for (const t of txs) {
    const r = fx(t.currency);
    const atMarket = openingLot?.(t) ?? null;
    if (atMarket != null) out.push({ date: t.executed_at, amount: -atMarket });
    else if (t.type === "buy") out.push({ date: t.executed_at, amount: -(t.quantity * t.price + t.fees) * r });
    else if (t.type === "sell") out.push({ date: t.executed_at, amount: (t.quantity * t.price - t.fees) * r });
    else if (t.type === "dividend" && includeDividends) out.push({ date: t.executed_at, amount: t.quantity * t.price * r });
  }
  out.push({ date: today, amount: endValue });
  return out;
}
