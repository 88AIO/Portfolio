import { createClient } from "@/lib/supabase/server";
import { toCsv, csvResponse, exportFilename, type CsvValue } from "@/lib/export/csv";
import { computeRealizedLots, lotsInYear, type LedgerTx } from "@/lib/tax/realized";
import { fetchAll } from "@/lib/supabase/paginate";

export const dynamic = "force-dynamic";

// Export the FIFO realized-gains report for a tax year as CSV — the record you (or your accountant)
// reconcile against a 1099. Auth-gated and RLS-scoped to the signed-in user's own transactions.

type TxRow = {
  type: string;
  quantity: number | null;
  price: number | null;
  fees: number | null;
  currency: string | null;
  executed_at: string | null;
  instruments: { symbol: string } | { symbol: string }[] | null;
};

function symbolOf(rel: TxRow["instruments"]): string | null {
  if (!rel) return null;
  return Array.isArray(rel) ? rel[0]?.symbol ?? null : rel.symbol;
}

function round(n: number, dp = 2): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const yearParam = Number(new URL(request.url).searchParams.get("year"));
  const year = Number.isFinite(yearParam) && yearParam > 1990 ? yearParam : Number(new Date().toISOString().slice(0, 4));

  // Transactions can exceed Supabase's ~1000-row cap; page through the whole ledger so FIFO
  // matching isn't run on a truncated read (which would drop recent sells and misstate the
  // proceeds/cost-basis/gain a user files against their 1099).
  const data = await fetchAll<TxRow>((from, to) =>
    supabase
      .from("transactions")
      .select("type, quantity, price, fees, currency, executed_at, instruments(symbol)")
      .order("executed_at", { ascending: true })
      .order("instrument_id", { ascending: true })
      .range(from, to),
  );

  const ledger: LedgerTx[] = (data as TxRow[])
    .map((t) => ({
      symbol: symbolOf(t.instruments) ?? "",
      currency: t.currency ?? "USD",
      type: t.type,
      quantity: t.quantity ?? 0,
      price: t.price ?? 0,
      fees: t.fees ?? 0,
      executed_at: t.executed_at ?? "",
    }))
    .filter((t) => t.symbol && t.executed_at);

  const lots = lotsInYear(computeRealizedLots(ledger), year);

  const headers = ["symbol", "quantity", "acquired", "sold", "term", "currency", "proceeds", "cost_basis", "gain_loss"];
  const rows: CsvValue[][] = lots.map((l) => [
    l.symbol,
    l.quantity,
    l.openDate,
    l.closeDate,
    l.longTerm ? "long" : "short",
    l.currency,
    round(l.proceeds),
    round(l.costBasis),
    round(l.gain),
  ]);

  return csvResponse(exportFilename(`realized-${year}`, new Date().toISOString().slice(0, 10)), toCsv(headers, rows));
}
