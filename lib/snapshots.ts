// Daily portfolio value snapshots. The nightly sync records each account's holdings value (in the
// account's own base currency) into portfolio_value_history — for EVERY account, every day, whether
// or not any trade happened. This builds a permanent, drift-proof value-over-time history going
// forward: unlike the trade-based reconstruction (whose reconciliation lots are recomputed each
// sync), a recorded snapshot is immutable once written.
import type { createAdminClient } from "@/lib/supabase/admin";
import { getCachedRates } from "@/lib/fx";
import { todayIso } from "@/lib/date";
import { fetchAll } from "@/lib/supabase/paginate";

type Admin = ReturnType<typeof createAdminClient>;

type PosRow = {
  portfolio_id: string;
  currency: string | null;
  current_total_price: number | null;
  cost_basis: number | null;
};

// Snapshot today's value for every account. Idempotent on (portfolio_id, d): re-running the same day
// overwrites with the latest prices. Returns how many account rows were written.
export async function snapshotPortfolioValues(admin: Admin): Promise<number> {
  // Cross-user (the service role sees every position), so page past the ~1000-row cap: an
  // unpaginated read would snapshot only the first page of accounts and write the rest a partial
  // — and, because snapshots override the reconstruction on the chart, permanently wrong — value.
  const [rows, { data: pfRows }] = await Promise.all([
    fetchAll<PosRow>((from, to) =>
      admin
        .from("positions")
        .select("portfolio_id, currency, current_total_price, cost_basis")
        .order("portfolio_id", { ascending: true })
        .order("instrument_id", { ascending: true })
        .range(from, to),
    ),
    admin.from("portfolios").select("id, base_currency"),
  ]);
  if (!rows.length) return 0;

  // Each account is recorded in ITS base currency — the currency the performance page charts it in.
  // Writing everything as USD drew a mixed-currency line for anyone whose base isn't USD.
  const baseByPortfolio = new Map<string, string>();
  for (const p of (pfRows ?? []) as { id: string; base_currency: string | null }[]) {
    baseByPortfolio.set(p.id, (p.base_currency || "USD").toUpperCase());
  }
  const bases = [...new Set([...baseByPortfolio.values(), "USD"])];
  const currencies = rows.map((r) => r.currency ?? "USD");
  const ratesByBase = new Map<string, Record<string, number>>();
  for (const base of bases) ratesByBase.set(base, await getCachedRates(admin, currencies, base));

  const byPortfolio = new Map<string, { mv: number; cost: number; base: string }>();
  for (const r of rows) {
    // A holding with no live price yet has null market value but a real cost basis. Recording its
    // full cost against a $0 value would bake a fabricated loss into the immutable daily snapshot
    // (and the performance chart drawn from it). Exclude it from BOTH sides until a price lands.
    if (r.current_total_price == null) continue;
    const base = baseByPortfolio.get(r.portfolio_id) ?? "USD";
    const rates = ratesByBase.get(base) ?? {};
    const f = rates[(r.currency ?? base).toUpperCase()] ?? 1;
    const e = byPortfolio.get(r.portfolio_id) ?? { mv: 0, cost: 0, base };
    e.mv += r.current_total_price * f;
    e.cost += (r.cost_basis ?? 0) * f;
    byPortfolio.set(r.portfolio_id, e);
  }

  const d = todayIso();
  const snapRows = [...byPortfolio.entries()].map(([portfolio_id, v]) => ({
    portfolio_id,
    d,
    market_value: v.mv,
    cost_basis: v.cost,
    currency: v.base,
  }));
  if (snapRows.length) {
    const { error } = await admin.from("portfolio_value_history").upsert(snapRows, { onConflict: "portfolio_id,d" });
    if (error) throw new Error(`snapshot write failed: ${error.message}`);
  }
  return snapRows.length;
}
