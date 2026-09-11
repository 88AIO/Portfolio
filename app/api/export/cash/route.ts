import { createClient } from "@/lib/supabase/server";
import { toCsv, csvResponse, exportFilename, type CsvValue } from "@/lib/export/csv";
import { fetchAll } from "@/lib/supabase/paginate";

export const dynamic = "force-dynamic";

// Export the manual cash ledger (deposits, withdrawals, interest, fees) the signed-in user recorded.

type Row = {
  entry_date: string;
  description: string | null;
  amount: number;
  currency: string;
  source: string;
  portfolio_id: string;
};

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const [rows, { data: pfs }] = await Promise.all([
    fetchAll<Row>((from, to) =>
      supabase
        .from("cash_ledger")
        .select("entry_date, description, amount, currency, source, portfolio_id")
        .order("entry_date", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to),
    ),
    supabase.from("portfolios").select("id, name"),
  ]);
  const pfName = new Map<string, string>(((pfs ?? []) as { id: string; name: string }[]).map((p) => [p.id, p.name]));

  const headers = ["date", "account", "description", "amount", "currency", "source"];
  const csvRows: CsvValue[][] = rows.map((r) => [
    r.entry_date, pfName.get(r.portfolio_id) ?? "", r.description, r.amount, r.currency, r.source,
  ]);

  const today = new Date().toISOString().slice(0, 10);
  return csvResponse(exportFilename("cash", today), toCsv(headers, csvRows));
}
