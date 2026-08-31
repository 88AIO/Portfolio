// Payout cadence, and the next ex-date when nobody has declared one.
//
// Both the nightly sync (writing div_frequency) and the forward calendar (placing payments on a
// month) need to answer "how often does this pay?". One copy, so they can never drift apart.

export type PayoutPoint = { exDate: string; amount: number };

// Standard payout cadences, payments per year: annual, semi-annual, quarterly, bi-monthly,
// monthly, fortnightly, weekly.
const CADENCES = [1, 2, 4, 6, 12, 26, 52];

/**
 * Payments per year, inferred from the spacing between recent ex-dates and snapped to a standard
 * cadence. More stable than counting payments in a rolling 366-day window, which flickers between
 * 3/4/5 for a quarterly payer as the boundary crosses a payment.
 *
 * @param history ascending by exDate.
 */
export function inferDivFrequency(history: PayoutPoint[]): number | null {
  if (history.length < 2) return history.length || null;
  const recent = history.slice(-9); // up to 8 gaps
  const gaps: number[] = [];
  for (let i = 1; i < recent.length; i++) {
    const days = (Date.parse(recent[i].exDate) - Date.parse(recent[i - 1].exDate)) / 86_400_000;
    if (days > 0) gaps.push(days);
  }
  if (!gaps.length) return null;
  gaps.sort((a, b) => a - b);
  const medianGap = gaps[Math.floor(gaps.length / 2)];
  const perYear = 365 / medianGap;
  return CADENCES.reduce((best, c) => (Math.abs(c - perYear) < Math.abs(best - perYear) ? c : best), CADENCES[0]);
}

/** Add whole months to YYYY-MM-DD, clamping the day to the target month's length. */
function addMonths(iso: string, months: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const anchor = new Date(Date.UTC(y, m - 1 + months, 1));
  const year = anchor.getUTCFullYear();
  const month = anchor.getUTCMonth();
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(Math.min(d, lastDay)).padStart(2, "0")}`;
}

function addDays(iso: string, days: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

/**
 * The next ex-date this holding is likely to pay, projected from its own payout history.
 *
 * Used only when the data provider has not declared one — for many tickers it never does, which
 * left those holdings out of the forward calendar entirely and made projected income look far
 * smaller than the annual figure beside it.
 *
 * Returns null rather than a guess when the history cannot support one:
 *
 *   • Fewer than two payments — there is no interval to measure.
 *   • The last payment is more than two intervals old. A payer that has missed two cycles may have
 *     suspended its dividend, and projecting income from a company that has stopped paying is
 *     exactly the confident wrong number this product refuses to print. Better to leave it out of
 *     the calendar, where its absence is already disclosed, than to invent income.
 *
 * @param history ascending by exDate
 * @param today   YYYY-MM-DD
 */
export function estimateNextExDate(history: PayoutPoint[], today: string): string | null {
  const paid = history.filter((p) => p.exDate && (p.amount ?? 0) > 0);
  if (paid.length < 2) return null;

  const freq = inferDivFrequency(paid);
  if (!freq || freq <= 0) return null;

  const last = paid[paid.length - 1].exDate;
  const intervalDays = 365 / freq;
  const sinceLast = (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${last}T00:00:00Z`)) / 86_400_000;
  if (!Number.isFinite(sinceLast)) return null;
  if (sinceLast > intervalDays * 2) return null; // two cycles missed — treat as stopped, not due

  // Step forward from the last real payment. Monthly-or-slower payers step in whole months, which
  // preserves the day of the month a company actually pays on; faster ones step in days so a
  // weekly distribution is not collapsed to twelve monthly events.
  const step = freq <= 12
    ? (d: string) => addMonths(d, Math.max(1, Math.round(12 / freq)))
    : (d: string) => addDays(d, Math.max(1, Math.round(intervalDays)));

  let next = step(last);
  let guard = 0;
  while (next < today && guard++ < 400) next = step(next);
  return next >= today ? next : null;
}
