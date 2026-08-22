// IV Rank — where today's implied volatility sits inside its own trailing range, 0 (calmest
// it's been) to 100 (most fearful). It's the honest way to read whether a put's premium is
// actually rich or just normal for this name. Standard definition:
//   rank = (currentIV − windowLow) / (windowHigh − windowLow) × 100
//
// We build the range from IV samples captured over time (one per scan / nightly). Until we've
// gathered enough samples across enough days, we refuse to show a number and say "building" —
// a shallow range would produce a confident-but-meaningless rank (see CLAUDE.md: honest data).

export const IV_RANK_MIN_SAMPLES = 8; // fewer than this → not enough spread to trust a rank
export const IV_RANK_MIN_SPAN_DAYS = 20; // and the samples must cover at least this many days
export const IV_RANK_WINDOW_DAYS = 365; // trailing window the range is drawn from

export type IvSample = { captured_on: string; iv: number }; // iv as a percent (e.g. 32.4)

export type IvRankResult = {
  rank: number | null; // 0..100, or null while still building history
  samples: number; // samples used from the window (incl. today)
  low: number | null; // window low IV (percent)
  high: number | null; // window high IV (percent)
  building: boolean; // true when we don't yet have enough history to judge
};

function daysBetween(a: string, b: string): number {
  return Math.abs(Date.parse(b) - Date.parse(a)) / 86_400_000;
}

/**
 * @param history      prior IV samples for this symbol (percent), any order
 * @param currentIv    today's IV (percent) from the live scan, or null if unavailable
 * @param today        YYYY-MM-DD
 */
export function computeIvRank(
  history: IvSample[],
  currentIv: number | null,
  today: string
): IvRankResult {
  const cutoff = IV_RANK_WINDOW_DAYS;
  // Keep in-window, finite samples; fold today's live reading in so the range always includes it.
  const pts = history
    .filter((s) => Number.isFinite(s.iv) && s.iv > 0 && daysBetween(s.captured_on, today) <= cutoff)
    .map((s) => ({ captured_on: s.captured_on.slice(0, 10), iv: s.iv }));
  if (currentIv != null && Number.isFinite(currentIv) && currentIv > 0) {
    pts.push({ captured_on: today, iv: currentIv });
  }
  // Dedupe to one sample per day (latest wins) so repeated same-day scans don't fake a range.
  const byDay = new Map<string, number>();
  for (const p of pts) byDay.set(p.captured_on, p.iv);
  const days = [...byDay.keys()].sort();
  const values = days.map((d) => byDay.get(d)!);

  const samples = values.length;
  if (samples === 0) return { rank: null, samples: 0, low: null, high: null, building: true };

  const low = Math.min(...values);
  const high = Math.max(...values);
  const spanDays = days.length > 1 ? daysBetween(days[0], days[days.length - 1]) : 0;

  const enough = samples >= IV_RANK_MIN_SAMPLES && spanDays >= IV_RANK_MIN_SPAN_DAYS;
  if (!enough || currentIv == null || high <= low) {
    return { rank: null, samples, low, high, building: true };
  }

  const rank = ((currentIv - low) / (high - low)) * 100;
  return {
    rank: Math.max(0, Math.min(100, rank)),
    samples,
    low,
    high,
    building: false,
  };
}
