// The S&P 500 benchmark instrument, kept current by the nightly sync whoever holds it.
//
// The performance page compares every portfolio with SPY, but SPY's prices were only refreshed
// because the owner happened to hold it; a user comparing against it while nobody held it would
// have been measured against a stale or missing series. Its dividends are fetched further back
// than any other instrument's, so the benchmark can reinvest every payout since a portfolio's
// first trade (total return).
import type { createAdminClient } from "@/lib/supabase/admin";
import { syncInstrumentDividends, syncInstrumentPriceHistory } from "./sync";
import { BENCHMARK } from "./benchmarkConfig";

type Admin = ReturnType<typeof createAdminClient>;

export { BENCHMARK } from "./benchmarkConfig";
/** How far back SPY's dividends are kept, so total return covers long-held portfolios. */
export const BENCHMARK_DIVIDEND_YEARS = 10;
/** First-time depth of SPY's price history, matching /api/backfill's default. */
const DEEP_HISTORY_DAYS = 2600;

/** The SPY instrument row, created if missing. */
export async function benchmarkInstrumentId(admin: Admin): Promise<string | null> {
  const find = () =>
    admin.from("instruments").select("id").eq("symbol", BENCHMARK.symbol).eq("exchange", BENCHMARK.exchange).maybeSingle();
  const { data } = await find();
  if (data?.id) return data.id as string;
  await admin.from("instruments").upsert(
    { symbol: BENCHMARK.symbol, exchange: BENCHMARK.exchange, name: BENCHMARK.name, currency: BENCHMARK.currency, type: BENCHMARK.type },
    { onConflict: "symbol,exchange", ignoreDuplicates: true },
  );
  const again = await find();
  return (again.data?.id as string | undefined) ?? null;
}

/**
 * Refresh SPY's dividends (ten years) and weekly closes. The first run, or one after the history
 * was lost, fetches the deep history; after that the nightly ~13-month window.
 */
export async function syncBenchmark(admin: Admin): Promise<{ ok: boolean; deep: boolean; error?: string }> {
  try {
    const id = await benchmarkInstrumentId(admin);
    if (!id) return { ok: false, deep: false, error: "benchmark instrument missing" };
    const { data: first } = await admin
      .from("price_history").select("d").eq("instrument_id", id).order("d", { ascending: true }).limit(1).maybeSingle();
    const cutoff = new Date(Date.now() - (DEEP_HISTORY_DAYS - 60) * 86_400_000).toISOString().slice(0, 10);
    const deep = !first?.d || (first.d as string) > cutoff;
    await syncInstrumentDividends(admin, id, BENCHMARK.symbol, BENCHMARK.exchange, BENCHMARK.currency, BENCHMARK_DIVIDEND_YEARS);
    await syncInstrumentPriceHistory(admin, id, BENCHMARK.symbol, BENCHMARK.exchange, deep ? DEEP_HISTORY_DAYS : 400, BENCHMARK.currency);
    return { ok: true, deep };
  } catch (e) {
    return { ok: false, deep: false, error: e instanceof Error ? e.message : String(e) };
  }
}
