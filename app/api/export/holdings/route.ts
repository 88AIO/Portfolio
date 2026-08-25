import { createClient } from "@/lib/supabase/server";
import { toCsv, csvResponse, exportFilename, type CsvValue } from "@/lib/export/csv";
import { fetchAll } from "@/lib/supabase/paginate";

export const dynamic = "force-dynamic";

// Export a snapshot of current holdings (the computed positions view) as CSV — a plain-file
// record of what you own right now, values included. Unlike the transactions export this is a
// point-in-time snapshot, not a re-importable ledger.

type PositionRow = {
  symbol: string;
  exchange: string;
  name: string | null;
  type: string | null;
  currency: string;
  sector: string | null;
  country_iso: string | null;
  shares: number | null;
  avg_cost: number | null;
  last_price: number | null;
  cost_basis: number | null;
  current_total_price: number | null;
  gain_value: number | null;
  day_change_pct: number | null;
  year_total_divs: number | null;
  div_yield_current: number | null;
  price_as_of: string | null;
};

function round(n: number | null | undefined, dp = 2): number | null {
  if (n == null || !Number.isFinite(n)) return null;
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  // RLS on the positions view scopes this to the signed-in user. Page through in case a portfolio
  // ever holds more than the ~1000-row cap, so the snapshot is never silently partial.
  const data = await fetchAll<PositionRow>((from, to) =>
    supabase
      .from("positions")
      .select(
        "symbol, exchange, name, type, currency, sector, country_iso, shares, avg_cost, last_price, cost_basis, current_total_price, gain_value, day_change_pct, year_total_divs, div_yield_current, price_as_of"
      )
      .order("symbol", { ascending: true })
      .order("exchange", { ascending: true })
      .range(from, to),
  );

  const headers = [
    "symbol", "exchange", "name", "type", "currency", "shares", "avg_cost", "last_price",
    "market_value", "cost_basis", "gain_value", "gain_pct", "day_change_pct",
    "annual_dividends", "yield_pct", "sector", "country", "price_as_of",
  ];
  const rows: CsvValue[][] = (data as PositionRow[]).map((p) => {
    const cost = p.cost_basis ?? 0;
    const gainPct = cost > 0 && p.gain_value != null ? (p.gain_value / cost) * 100 : null;
    return [
      p.symbol,
      p.exchange,
      p.name,
      p.type,
      p.currency,
      round(p.shares, 6),
      round(p.avg_cost, 4),
      round(p.last_price, 4),
      round(p.current_total_price),
      round(cost),
      round(p.gain_value),
      round(gainPct),
      round(p.day_change_pct),
      round(p.year_total_divs),
      round(p.div_yield_current),
      p.sector,
      p.country_iso,
      p.price_as_of,
    ];
  });

  const today = new Date().toISOString().slice(0, 10);
  return csvResponse(exportFilename("holdings", today), toCsv(headers, rows));
}
