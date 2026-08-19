// Dividend-safety score — a calm, honest 0–100 read on how dependable a holding's
// dividend looks, computed only from data we actually have: the synced payout history
// plus the current yield. No black-box vendor rating, no confident-wrong number — when
// the history is too thin to judge, we say so instead of guessing.
//
// The score is a signal, not advice (see CLAUDE.md — "track & inform, never advise").
// Weighting reflects what actually predicts a dividend cut, in order:
//   • cuts      (40) — a past cut is the single loudest warning; recent cuts weigh most
//   • record    (25) — years of uninterrupted payments build confidence
//   • growth    (20) — a rising payout is a healthier sign than a flat one
//   • yield      (15) — an extreme yield is often a market warning (yield trap / ROC)

export type DividendPoint = { exDate: string; amount: number };

export type SafetyFactor = {
  key: "record" | "cuts" | "growth" | "yield";
  label: string;
  detail: string;
  /** 0..1 — how much of this factor's weight was earned. */
  score: number;
};

export type SafetyBand = "very-safe" | "safe" | "watch" | "at-risk" | "unrated";

export type DividendSafety = {
  score: number | null; // null when history is too thin to judge honestly
  band: SafetyBand;
  label: string;
  summary: string;
  factors: SafetyFactor[];
  yearsOfHistory: number;
};

const WEIGHTS = { cuts: 40, record: 25, growth: 20, yield: 15 };

/** Sum per-share payouts into complete calendar years, dropping the current (partial) year. */
function annualTotals(history: DividendPoint[]): { year: number; total: number }[] {
  const byYear = new Map<number, number>();
  for (const p of history) {
    const amt = Number(p.amount);
    if (!Number.isFinite(amt) || amt <= 0) continue;
    const year = Number((p.exDate || "").slice(0, 4));
    if (!Number.isFinite(year) || year < 1900) continue;
    byYear.set(year, (byYear.get(year) ?? 0) + amt);
  }
  const currentYear = Number(new Date().toISOString().slice(0, 4));
  return [...byYear.entries()]
    .filter(([year]) => year < currentYear) // current year is still in progress → not comparable
    .map(([year, total]) => ({ year, total }))
    .sort((a, b) => a.year - b.year);
}

function band(score: number): { band: SafetyBand; label: string } {
  if (score >= 80) return { band: "very-safe", label: "Very safe" };
  if (score >= 60) return { band: "safe", label: "Safe" };
  if (score >= 40) return { band: "watch", label: "Watch" };
  return { band: "at-risk", label: "At risk" };
}

/**
 * Compute the dividend-safety score.
 * @param history  full per-share payout history for the instrument
 * @param yieldPct current dividend yield as a percent (e.g. 4.2), used only for the yield-sanity factor
 */
export function dividendSafety(
  history: DividendPoint[],
  yieldPct: number | null | undefined
): DividendSafety {
  const years = annualTotals(history);

  // Honest floor: with fewer than two complete years we can't spot a cut or a trend.
  if (years.length < 2) {
    return {
      score: null,
      band: "unrated",
      label: "Building history",
      summary: "Not enough payout history yet to judge safety.",
      factors: [],
      yearsOfHistory: years.length,
    };
  }

  const yearsOfHistory = years.length;

  // --- Cuts (40) — the heaviest signal. Compare each complete year to the one before it.
  // A cut hurts in proportion to its depth and how recent it is (recent cuts weigh most).
  let cutPenalty = 0;
  let worstCut = 0;
  let cutCount = 0;
  for (let i = 1; i < years.length; i++) {
    const prev = years[i - 1].total;
    const cur = years[i].total;
    if (prev <= 0) continue;
    const drop = (prev - cur) / prev; // >0 means the annual payout fell
    if (drop > 0.05) {
      cutCount++;
      worstCut = Math.max(worstCut, drop);
      // Recency weight: the most recent comparison counts fully, older ones taper to ~0.4.
      const recency = 0.4 + 0.6 * (i / (years.length - 1));
      cutPenalty += Math.min(1, drop) * recency;
    }
  }
  const cutsScore = Math.max(0, 1 - cutPenalty); // 1 = never cut
  const cutsDetail =
    cutCount === 0
      ? `No annual cut in ${yearsOfHistory} years`
      : `${cutCount} year${cutCount === 1 ? "" : "s"} down, worst −${Math.round(worstCut * 100)}%`;

  // --- Track record (25) — years of uninterrupted payments. Full marks at ~10 years.
  const recordScore = Math.min(1, yearsOfHistory / 10);
  const recordDetail = `${yearsOfHistory} complete year${yearsOfHistory === 1 ? "" : "s"} of payouts`;

  // --- Growth (20) — annualised growth of the payout across the record.
  const first = years[0].total;
  const last = years[years.length - 1].total;
  const span = years.length - 1;
  const cagr = first > 0 && span > 0 ? Math.pow(last / first, 1 / span) - 1 : 0;
  // Map −5%..+10% CAGR onto 0..1; flat (0%) lands at ~0.33.
  const growthScore = Math.max(0, Math.min(1, (cagr + 0.05) / 0.15));
  const growthDetail =
    cagr >= 0.001
      ? `Growing ~${(cagr * 100).toFixed(1)}%/yr`
      : cagr <= -0.001
        ? `Shrinking ~${(cagr * 100).toFixed(1)}%/yr`
        : "Flat payout";

  // --- Yield sanity (15) — a normal yield is reassuring; an extreme one is a warning.
  // 1.5%–6% earns full marks; it tapers above 8% (trap territory) and below 0.5%.
  let yieldScore = 0.6;
  let yieldDetail = "Yield unavailable";
  if (typeof yieldPct === "number" && Number.isFinite(yieldPct)) {
    const y = yieldPct;
    if (y <= 0) yieldScore = 0.5;
    else if (y < 1.5) yieldScore = 0.6 + (y / 1.5) * 0.4; // 0.6..1.0
    else if (y <= 6) yieldScore = 1;
    else if (y <= 8) yieldScore = 1 - ((y - 6) / 2) * 0.4; // 1.0..0.6
    else if (y <= 12) yieldScore = 0.6 - ((y - 8) / 4) * 0.4; // 0.6..0.2
    else yieldScore = 0.15;
    yieldDetail = `${y.toFixed(1)}% current yield${y > 8 ? " — elevated" : ""}`;
  }

  const factors: SafetyFactor[] = [
    { key: "cuts", label: "Cut history", detail: cutsDetail, score: cutsScore },
    { key: "record", label: "Track record", detail: recordDetail, score: recordScore },
    { key: "growth", label: "Growth", detail: growthDetail, score: growthScore },
    { key: "yield", label: "Yield sanity", detail: yieldDetail, score: yieldScore },
  ];

  const raw =
    cutsScore * WEIGHTS.cuts +
    recordScore * WEIGHTS.record +
    growthScore * WEIGHTS.growth +
    yieldScore * WEIGHTS.yield;
  const score = Math.round(Math.max(0, Math.min(100, raw)));
  const { band: b, label } = band(score);

  const summary =
    cutCount > 0
      ? `Paid for ${yearsOfHistory} years but cut the payout ${cutCount === 1 ? "once" : `${cutCount} times`}.`
      : cagr >= 0.001
        ? `Uninterrupted for ${yearsOfHistory} years and still growing.`
        : `Uninterrupted for ${yearsOfHistory} years, payout roughly flat.`;

  return { score, band: b, label, summary, factors, yearsOfHistory };
}
