// Daily portfolio value snapshots. The nightly sync records each account's holdings value (in the
// base currency) into portfolio_value_history — for EVERY account, every day, whether or not any
// trade happened. This builds a permanent, drift-proof value-over-time history going forward: unlike
// the trade-based reconstruction (whose reconciliation lots are recomputed each sync), a recorded
// snapshot is immutable once written.
import type { createAdminClient } from "@/lib/supabase/admin";
import { getCachedRates } from "@/lib/fx";
import { todayIso } from "@/lib/date";

type Admin = ReturnType<typeof createAdminClient>;

type PosRow = {
  portfolio_id: string;
  currency: string | null;
  current_total_price: number | null;
  cost_basis: number | null;
};

// Snapshot today's value for every account. Idempotent on (portfolio_id, d): re-running the same day
// overwrites with the latest prices. Returns how many account rows were written.
export async function snapshotPortfolioValues(admin: Admin, base = "USD"): Promise<number> {
  const { data } = await admin
    .from("positions")
    .select("portfolio_id, currency, current_total_price, cost_basis");
  const rows = (data ?? []) as PosRow[];
  if (!rows.length) return 0;

  const rates = await getCachedRates(admin, rows.map((r) => r.currency ?? base), base);
  const fx = (c: string | null) => rates[c ?? base] ?? 1;

  const byPortfolio = new Map<string, { mv: number; cost: number }>();
  for (const r of rows) {
    // A holding with no live price yet has null market value but a real cost basis. Recording its
    // full cost against a $0 value would bake a fabricated loss into the immutable daily snapshot
    // (and the performance chart drawn from it). Exclude it from BOTH sides until a price lands.
    if (r.current_total_price == null) continue;
    const f = fx(r.currency);
    const e = byPortfolio.get(r.portfolio_id) ?? { mv: 0, cost: 0 };
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
    currency: base,
  }));
  if (snapRows.length) {
    await admin.from("portfolio_value_history").upsert(snapRows, { onConflict: "portfolio_id,d" });
  }
  return snapRows.length;
}
