// Time-range presets for the value-over-time chart.
//
// The date arithmetic lives here, apart from the component, because it is exactly the kind of code
// that looks obviously right and is quietly wrong: JavaScript's month arithmetic rolls over
// (31 March minus one month is 3 March, not 28 February), and reading a YYYY-MM-DD through a local
// Date shifts the day west of UTC. Both are tested in tests/performance-ranges.test.mjs.

export type RangeKey = "1M" | "6M" | "YTD" | "1Y" | "5Y" | "MAX" | "CUSTOM";

// Presets shortest-first, the order people scan for on a price chart, with the custom range last
// because it is the escape hatch rather than the common case.
export const RANGE_PRESETS: { key: RangeKey; label: string; title: string }[] = [
  { key: "1M", label: "1M", title: "Past month" },
  { key: "6M", label: "6M", title: "Past six months" },
  { key: "YTD", label: "YTD", title: "Since January 1st" },
  { key: "1Y", label: "1Y", title: "Past year" },
  { key: "5Y", label: "5Y", title: "Past five years" },
  { key: "MAX", label: "Max", title: "Everything on record" },
];

/** Subtract whole months, clamping to the target month's last day (31 Mar − 1 month = 28/29 Feb). */
function minusMonths(iso: string, months: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  // Anchor on day 1 so the shift itself can never roll into the following month, then clamp.
  const anchor = new Date(Date.UTC(y, m - 1 - months, 1));
  const year = anchor.getUTCFullYear();
  const month = anchor.getUTCMonth();
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const day = Math.min(d, lastDay);
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * Inclusive lower bound for a preset, or null for no bound (Max).
 * @param today YYYY-MM-DD — the anchor, passed in so the caller controls "now".
 */
export function rangeStart(key: RangeKey, today: string): string | null {
  switch (key) {
    case "1M": return minusMonths(today, 1);
    case "6M": return minusMonths(today, 6);
    case "1Y": return minusMonths(today, 12);
    case "5Y": return minusMonths(today, 60);
    case "YTD": return `${today.slice(0, 4)}-01-01`;
    default: return null; // MAX, and CUSTOM which carries its own bounds
  }
}

export type CustomRange = { from: string; to: string };

/**
 * Slice a date-ascending series to a range. Always returns at least two points when the series has
 * them: a chart with one point draws nothing, and a blank panel reads as "no data" when the truth
 * is "nothing happened in this window" — so a too-narrow range falls back to the last two points
 * rather than showing an empty frame.
 */
export function filterByRange<T extends { date: string }>(
  points: T[],
  key: RangeKey,
  today: string,
  custom?: CustomRange
): T[] {
  if (!points.length) return points;

  let from: string | null;
  let to: string | null = null;
  if (key === "CUSTOM") {
    if (!custom?.from || !custom?.to) return points;
    // Tolerate a backwards range rather than showing nothing.
    [from, to] = custom.from <= custom.to ? [custom.from, custom.to] : [custom.to, custom.from];
  } else {
    from = rangeStart(key, today);
  }

  const sliced = points.filter((p) => (!from || p.date >= from) && (!to || p.date <= to));
  return sliced.length >= 2 ? sliced : points.slice(-2);
}

/**
 * X-axis tick format for the window's width. A five-year view labelled "Mar 24, 2026" is unreadable
 * and a one-month view labelled "Mar 26" repeats the same tick four times, so the label carries
 * exactly the parts that change across the visible span.
 */
export function tickFormatterFor(points: { date: string }[]): (d: string) => string {
  const MONTHS = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  if (!points.length) return (d) => d;

  const first = points[0].date;
  const last = points[points.length - 1].date;
  const spanDays = (Date.parse(`${last}T00:00:00Z`) - Date.parse(`${first}T00:00:00Z`)) / 86_400_000;

  // Under ~4 months: day and month, since the year never changes across the window.
  if (spanDays <= 130) {
    return (d) => {
      const [, m, day] = d.split("-");
      return `${MONTHS[Number(m)]} ${Number(day)}`;
    };
  }
  // Under ~3 years: month and two-digit year.
  if (spanDays <= 1100) {
    return (d) => {
      const [y, m] = d.split("-");
      return `${MONTHS[Number(m)]} ${y.slice(2)}`;
    };
  }
  // Longer: the year alone. minTickGap thins the repeats.
  return (d) => d.slice(0, 4);
}

export type RangeChange = {
  from: string;
  to: string;
  valueFrom: number;
  valueTo: number;
  /** Change in portfolio value across the window. Includes any money added — see gainAbs. */
  valueAbs: number;
  /** null when the window opens at zero: there is no percentage change from nothing. */
  valuePct: number | null;
  /**
   * Change in (value − net invested) across the window: what the market did, with contributions
   * netted out. A month where you deposited 10k and the market did nothing shows a large valueAbs
   * and a gainAbs near zero, which is the honest read of "how did my investments do".
   */
  gainAbs: number;
};

/** Movement across the visible window. null when there is nothing to compare. */
export function rangeChange(
  points: { date: string; value: number; invested: number }[]
): RangeChange | null {
  if (points.length < 2) return null;
  const a = points[0];
  const b = points[points.length - 1];
  const valueAbs = b.value - a.value;
  return {
    from: a.date,
    to: b.date,
    valueFrom: a.value,
    valueTo: b.value,
    valueAbs,
    valuePct: a.value > 0 ? (valueAbs / a.value) * 100 : null,
    gainAbs: (b.value - b.invested) - (a.value - a.invested),
  };
}
