// Cached FX. Pages read rates from the fx_rates table (instant, no network) instead of calling a
// live provider at render time — the single biggest render-latency source for portfolios that hold
// non-USD currencies. The nightly sync refreshes the table via syncFxRates().
import type { SupabaseClient } from "@supabase/supabase-js";
import { getFxRate } from "@/lib/marketdata";

// Approximate <currency>→USD, used only when a rate is missing from the cache (fresh currency the
// nightly job hasn't fetched yet). Better than a silent 1.0, which would treat e.g. HKD as USD.
const FALLBACK_USD: Record<string, number> = {
  USD: 1, HKD: 0.1282, SGD: 0.78, TWD: 0.0322, MYR: 0.212, CNH: 0.14, CNY: 0.14,
  JPY: 0.0067, KRW: 0.00072, INR: 0.0116, THB: 0.028, GBP: 1.27, EUR: 1.08,
  CAD: 0.73, AUD: 0.66, CHF: 1.12, HUF: 0.0028,
};

// Currencies we always keep warm in the cache, even if not currently held.
const COMMON = ["USD", "HKD", "SGD", "TWD", "MYR", "CNH", "CNY", "EUR", "GBP", "JPY"];

// Build currency→base multipliers from the cache. `supabase` may be the RLS user client (pages) or
// the service-role client (crons) — both can read fx_rates.
export async function getCachedRates(
  supabase: SupabaseClient,
  currencies: string[],
  base = "USD",
): Promise<Record<string, number>> {
  const uniq = [...new Set([...currencies.filter(Boolean), base].map((c) => c.toUpperCase()))];
  const { data } = await supabase.from("fx_rates").select("quote, usd_rate");
  const usd: Record<string, number> = {};
  for (const r of (data ?? []) as { quote: string; usd_rate: number }[]) usd[r.quote.toUpperCase()] = Number(r.usd_rate);

  const toUsd = (c: string) => usd[c] ?? FALLBACK_USD[c] ?? 1;
  const baseUsd = toUsd(base.toUpperCase()) || 1;
  const out: Record<string, number> = {};
  for (const c of uniq) out[c] = toUsd(c) / baseUsd;
  return out;
}

// Refresh the fx_rates cache from the live provider. Runs in the nightly sync only. Keeps a prior
// cached value when a lookup fails (never overwrites a good rate with a failed 1.0).
export async function syncFxRates(admin: SupabaseClient): Promise<number> {
  const { data } = await admin.from("instruments").select("currency");
  const held = (data ?? [])
    .map((r: { currency: string | null }) => (r.currency ?? "USD").toUpperCase())
    .filter(Boolean);
  const currencies = [...new Set([...held, ...COMMON])];

  const now = new Date().toISOString();
  const rows: { quote: string; usd_rate: number; as_of: string }[] = [{ quote: "USD", usd_rate: 1, as_of: now }];
  for (const c of currencies) {
    if (c === "USD") continue;
    try {
      const r = await getFxRate(c, "USD");
      if (r && r > 0 && r !== 1) rows.push({ quote: c, usd_rate: r, as_of: now });
    } catch { /* keep the prior cached value */ }
  }
  if (rows.length) await admin.from("fx_rates").upsert(rows, { onConflict: "quote" });
  return rows.length;
}
