import { timeAgo } from "@/lib/format";

// Honest-data cue: a small "Prices as of …" label shown wherever price-derived numbers appear.
// Pass the OLDEST price timestamp across the holdings on the page so the label never overstates
// freshness. Renders nothing when there's no priced data yet.
export default function PricesAsOf({ asOf }: { asOf: string | null | undefined }) {
  if (!asOf) return null;
  return (
    <span className="text-xs text-slate-400" title={new Date(asOf).toLocaleString()}>
      Prices as of {timeAgo(asOf)}
    </span>
  );
}

/** Oldest (most stale) price timestamp across rows, as an ISO string — or null if none priced. */
export function oldestPriceAsOf(rows: { last_price?: number | null; price_as_of?: string | null }[]): string | null {
  const times = rows
    .filter((r) => r.last_price != null && r.price_as_of)
    .map((r) => new Date(r.price_as_of as string).getTime())
    .filter((t) => !isNaN(t));
  return times.length ? new Date(Math.min(...times)).toISOString() : null;
}
