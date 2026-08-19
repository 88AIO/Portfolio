import type { DividendSafety, SafetyBand } from "@/lib/dividends/safety";

const STYLES: Record<SafetyBand, { dot: string; pill: string; text: string }> = {
  "very-safe": { dot: "bg-emerald-500", pill: "bg-emerald-50 border-emerald-200", text: "text-emerald-700" },
  safe: { dot: "bg-sky-500", pill: "bg-sky-50 border-sky-200", text: "text-sky-700" },
  watch: { dot: "bg-amber-500", pill: "bg-amber-50 border-amber-200", text: "text-amber-700" },
  "at-risk": { dot: "bg-rose-500", pill: "bg-rose-50 border-rose-200", text: "text-rose-700" },
  unrated: { dot: "bg-slate-300", pill: "bg-slate-50 border-slate-200", text: "text-slate-500" },
};

/** Calm dividend-safety pill: a colored dot, the score, and the band label. Native title = detail on hover. */
export default function SafetyBadge({ safety }: { safety: DividendSafety }) {
  const s = STYLES[safety.band];
  const title = [
    safety.summary,
    ...safety.factors.map((f) => `${f.label}: ${f.detail}`),
  ].join("\n");
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium ${s.pill} ${s.text}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} />
      {safety.score != null ? (
        <>
          <span className="tabular-nums">{safety.score}</span>
          <span className="opacity-70">{safety.label}</span>
        </>
      ) : (
        <span>{safety.label}</span>
      )}
    </span>
  );
}
