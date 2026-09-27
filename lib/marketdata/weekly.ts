// Weekly closes, dated when they actually happened.
//
// Providers' weekly bars are stamped with the week's FIRST day but carry its LAST close: Yahoo's
// bar dated Monday 14 Sep holds Friday 18 Sep's close. Stored that way, every "close on or before
// date X" lookup inside a week returned a price from up to four trading days in the future, so the
// S&P 500 benchmark bought SPY at the week's closing price for a trade made on Monday. Fetching
// daily bars and keeping each week's last one gives the same ~52 points a year, each on its real
// date. ISO weeks run Monday to Sunday, so a crypto week naturally ends on its Sunday close.
import type { PriceHistoryPoint } from "./types";

/** The Monday (UTC) of the ISO week containing `date` (YYYY-MM-DD). */
export function weekStart(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

/**
 * The last completed close of each ISO week, ascending.
 *
 * Bars dated `today` (UTC) or later are dropped: the sync runs at 06:00 UTC, when Asian exchanges
 * are mid-session and a crypto day is six hours old, so today's bar is an intraday price, not a
 * close. Stored under today's date it would never be corrected once a later day became the week's
 * last. The finished bar arrives on the next run.
 */
export function lastCloseOfEachWeek(
  points: PriceHistoryPoint[],
  today: string = new Date().toISOString().slice(0, 10),
): PriceHistoryPoint[] {
  const byWeek = new Map<string, PriceHistoryPoint>();
  for (const p of points) {
    if (p.date >= today) continue;
    const key = weekStart(p.date);
    const cur = byWeek.get(key);
    if (!cur || p.date > cur.date) byWeek.set(key, p);
  }
  return [...byWeek.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/** Number of ISO weeks touched by [from, to]. */
export function weeksSpanned(from: string, to: string): number {
  const a = Date.parse(`${weekStart(from)}T00:00:00Z`);
  const b = Date.parse(`${weekStart(to)}T00:00:00Z`);
  return Math.round((b - a) / (7 * 86_400_000)) + 1;
}

/**
 * Stored dates inside a freshly fetched window that the fetch did not return: week-start stamps
 * left by the old weekly bars (a later close under an earlier date) and intraday prices once saved
 * as closes. Nothing is listed unless the fetch covers at least 80% of the window's weeks, so a
 * provider hiccup that returns a gappy series can't delete good history.
 */
export function datesToReplace(fetched: PriceHistoryPoint[], stored: string[]): string[] {
  if (!fetched.length) return [];
  const from = fetched[0].date;
  const to = fetched[fetched.length - 1].date;
  if (fetched.length < 0.8 * weeksSpanned(from, to)) return [];
  const keep = new Set(fetched.map((p) => p.date));
  return stored.filter((d) => d >= from && d <= to && !keep.has(d));
}
