// Dividend income actually received, and a forward estimate.
//
// History comes from the user's own dividend transactions, not from the instrument's payout
// history. Those are different numbers: a payout the stock made in 2024 multiplied by the shares
// you hold *today* is not what landed in your account, and shows income for a holding you may not
// have owned yet. Only the ledger knows what you were actually paid.

export type DividendTx = {
  executed_at: string; // YYYY-MM-DD
  quantity: number; // shares held at the payment
  price: number; // per-share amount
  currency: string;
};

export type MonthBucket = { key: string; label: string; total: number };
export type YearBucket = { year: number; total: number; basis: "actual" | "partial" | "estimate" };

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function monthKeysBack(today: string, count: number): string[] {
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7)) - 1;
  const keys: string[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(y, m - i, 1));
    keys.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  return keys;
}

/**
 * Dividend cash received per month over the trailing `months`, oldest first and zero-filled.
 * Zero-filling matters: a month with no payout is information (a gap in the income stream), and
 * dropping it would silently close the gap and make the chart look steadier than the income was.
 */
export function monthlyDividendHistory(
  txs: DividendTx[],
  fx: (currency: string) => number,
  today: string,
  months = 24
): MonthBucket[] {
  const totals = new Map<string, number>();
  for (const t of txs) {
    const key = (t.executed_at || "").slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(key)) continue;
    const amount = (t.quantity || 0) * (t.price || 0) * fx(t.currency);
    if (!Number.isFinite(amount)) continue;
    totals.set(key, (totals.get(key) ?? 0) + amount);
  }
  return monthKeysBack(today, months).map((key) => ({
    key,
    label: `${MONTHS[Number(key.slice(5, 7)) - 1]} ${key.slice(2, 4)}`,
    total: totals.get(key) ?? 0,
  }));
}

/**
 * Income by calendar year: the completed years behind you, the current year so far, and a forward
 * estimate for the years ahead.
 *
 * The forward number is a run rate — today's holdings paying today's declared rate — carried flat.
 * It is deliberately not grown: projecting dividend growth compounds an assumption into a figure
 * people would plan around, and a flat carry is the honest floor. Each bucket says which it is, so
 * the UI can label an estimate as an estimate rather than letting it sit beside actuals unmarked.
 *
 * @param annualRunRate current annual income from held positions, base currency
 * @param pastYears     completed years to include before the current one
 * @param forwardYears  years to project after the current one
 */
export function annualDividendSummary(
  txs: DividendTx[],
  fx: (currency: string) => number,
  today: string,
  annualRunRate: number,
  pastYears = 2,
  forwardYears = 3
): YearBucket[] {
  const currentYear = Number(today.slice(0, 4));
  const received = new Map<number, number>();
  for (const t of txs) {
    const year = Number((t.executed_at || "").slice(0, 4));
    if (!Number.isFinite(year) || year < 1900) continue;
    const amount = (t.quantity || 0) * (t.price || 0) * fx(t.currency);
    if (!Number.isFinite(amount)) continue;
    received.set(year, (received.get(year) ?? 0) + amount);
  }

  const out: YearBucket[] = [];
  for (let y = currentYear - pastYears; y < currentYear; y++) {
    out.push({ year: y, total: received.get(y) ?? 0, basis: "actual" });
  }
  // The current year is part banked, part still to come, so it is neither an actual nor a pure
  // estimate — the remaining months are filled in at the run rate.
  const monthsElapsed = Number(today.slice(5, 7));
  const remaining = Math.max(0, 12 - monthsElapsed);
  out.push({
    year: currentYear,
    total: (received.get(currentYear) ?? 0) + (annualRunRate * remaining) / 12,
    basis: "partial",
  });
  for (let i = 1; i <= forwardYears; i++) {
    out.push({ year: currentYear + i, total: annualRunRate, basis: "estimate" });
  }
  return out;
}
