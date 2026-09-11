import { createClient } from "@/lib/supabase/server";
import { toCsv, csvResponse, exportFilename, type CsvValue } from "@/lib/export/csv";
import { fetchAll } from "@/lib/supabase/paginate";
import { legPremium } from "@/lib/options";

export const dynamic = "force-dynamic";

// Export every option leg the signed-in user owns. The options ledger is the product's signature
// data and the "no lock-in" promise did not cover it: the transactions export carried equities only,
// so a seller who left took their share trades and lost every premium they had ever recorded.

type Rel = { symbol: string; exchange: string } | { symbol: string; exchange: string }[] | null;
type Row = {
  trade_date: string;
  action: string;
  option_type: string;
  strike: number;
  expiration: string;
  contracts: number;
  premium: number;
  fee: number | null;
  currency: string;
  note: string | null;
  portfolio_id: string;
  instruments: Rel;
};

function rel(r: Rel): { symbol: string; exchange: string } | null {
  if (!r) return null;
  return Array.isArray(r) ? r[0] ?? null : r;
}

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const [rows, { data: pfs }] = await Promise.all([
    fetchAll<Row>((from, to) =>
      supabase
        .from("option_transactions")
        .select("trade_date, action, option_type, strike, expiration, contracts, premium, fee, currency, note, portfolio_id, instruments(symbol, exchange)")
        .order("trade_date", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to),
    ),
    supabase.from("portfolios").select("id, name"),
  ]);
  const pfName = new Map<string, string>(((pfs ?? []) as { id: string; name: string }[]).map((p) => [p.id, p.name]));

  const headers = ["date", "symbol", "exchange", "account", "action", "option_type", "strike", "expiration", "contracts", "premium_per_share", "fee", "net_premium", "currency", "note"];
  const csvRows: CsvValue[][] = rows.map((o) => {
    const inst = rel(o.instruments);
    return [
      o.trade_date,
      inst?.symbol ?? "",
      inst?.exchange ?? "",
      pfName.get(o.portfolio_id) ?? "",
      o.action,
      o.option_type,
      o.strike,
      o.expiration,
      o.contracts,
      o.premium,
      o.fee ?? 0,
      // Signed cash effect of the leg, the same figure every income view uses.
      Math.round(legPremium(o) * 100) / 100,
      o.currency,
      o.note,
    ];
  });

  const today = new Date().toISOString().slice(0, 10);
  return csvResponse(exportFilename("options", today), toCsv(headers, csvRows));
}
