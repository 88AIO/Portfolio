// Forward dividend calendar — projects the next 12 months of expected payouts per holding
// and rolls them up by month, so "what income is coming, and when" is answerable at a glance.
//
// Honest by design: every event is an *estimate* projected from the known next ex/pay date
// stepped by the payout frequency. Holdings with no known next date can't be placed on a
// month, so they're counted separately rather than guessed onto the wrong month.

export type CalendarPosition = {
  instrument_id: string;
  symbol: string;
  currency: string;
  shares: number;
  annual_div_per_share: number | null;
  div_frequency: number | null; // payments per year
  next_dividend_date: string | null; // YYYY-MM-DD
  next_dividend_per_share: number | null;
};

export type CalendarEvent = {
  instrument_id: string;
  symbol: string;
  date: string; // YYYY-MM-DD
  perShare: number;
  currency: string;
  amount: number; // perShare * shares, in the holding's own currency
  amountBase: number; // converted to the base currency
};

export type CalendarMonth = {
  key: string; // YYYY-MM
  label: string; // e.g. "Sep 2026"
  total: number; // base currency
  events: CalendarEvent[];
};

export type DividendCalendar = {
  months: CalendarMonth[]; // exactly 12, chronological, starting this month
  total: number; // base currency, summed across the window
  untimedCount: number; // dividend payers we couldn't place (no known next date)
};

/** Add whole months to a YYYY-MM-DD date, clamping the day to the target month's length. */
function addMonths(iso: string, months: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const base = new Date(Date.UTC(y, m - 1, 1));
  base.setUTCMonth(base.getUTCMonth() + months);
  const year = base.getUTCFullYear();
  const month = base.getUTCMonth(); // 0-based
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const day = Math.min(d, lastDay);
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * Build the 12-month forward calendar.
 * @param positions dividend-relevant holdings
 * @param fx        holding-currency → base-currency multiplier
 * @param today     YYYY-MM-DD (injected so the caller controls "now")
 */
export function buildDividendCalendar(
  positions: CalendarPosition[],
  fx: (currency: string) => number,
  today: string
): DividendCalendar {
  // Twelve month buckets starting with the current month.
  const startYear = Number(today.slice(0, 4));
  const startMonth = Number(today.slice(5, 7)) - 1; // 0-based
  const months: CalendarMonth[] = [];
  const indexByKey = new Map<string, number>();
  for (let i = 0; i < 12; i++) {
    const dt = new Date(Date.UTC(startYear, startMonth + i, 1));
    const key = `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}`;
    indexByKey.set(key, months.length);
    months.push({ key, label: `${MONTH_NAMES[dt.getUTCMonth()]} ${dt.getUTCFullYear()}`, total: 0, events: [] });
  }
  const windowEnd = addMonths(`${months[11].key}-01`, 1); // exclusive upper bound (first day after last month)

  let untimedCount = 0;
  let total = 0;

  for (const p of positions) {
    const annual = p.annual_div_per_share ?? 0;
    if (annual <= 0 || p.shares <= 0) continue;

    const freq = p.div_frequency && p.div_frequency > 0 ? p.div_frequency : null;
    if (!p.next_dividend_date || !freq) {
      untimedCount++;
      continue;
    }

    const perShare = p.next_dividend_per_share ?? annual / freq;
    if (perShare <= 0) continue;

    const stepMonths = Math.max(1, Math.round(12 / freq));
    const rate = fx(p.currency);

    // Walk forward from the known next date, one interval at a time, until we leave the window.
    let date = p.next_dividend_date;
    if (date < today) {
      // Catch a stale next-date up to the current month before projecting forward.
      let catchUp = 0;
      while (date < today && catchUp++ < 600) date = addMonths(date, stepMonths);
    }
    let guard = 0;
    while (date < windowEnd && guard++ < 60) {
      const key = date.slice(0, 7);
      const idx = indexByKey.get(key);
      if (idx != null && date >= today) {
        const amount = perShare * p.shares;
        const amountBase = amount * rate;
        months[idx].events.push({
          instrument_id: p.instrument_id,
          symbol: p.symbol,
          date,
          perShare,
          currency: p.currency,
          amount,
          amountBase,
        });
        months[idx].total += amountBase;
        total += amountBase;
      }
      date = addMonths(date, stepMonths);
    }
  }

  for (const m of months) m.events.sort((a, b) => a.date.localeCompare(b.date));

  return { months, total, untimedCount };
}
