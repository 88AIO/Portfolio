import { createClient } from "@/lib/supabase/server";
import { toCsv, csvResponse, exportFilename, type CsvValue } from "@/lib/export/csv";

export const dynamic = "force-dynamic";

// Export every transaction the signed-in user owns as a re-importable CSV. Column names match
// the importer's canonical fields, so an exported file round-trips straight back in — and because
// we reconstruct the original `ref` from the stored dedupe_key, re-importing is idempotent
// (no duplicate rows). This is the "no lock-in / export" promise from the roadmap.

type InstrumentRef = { symbol: string; exchange: string } | { symbol: string; exchange: string }[] | null;
type TxRow = {
  executed_at: string | null;
  type: string;
  quantity: number | null;
  price: number | null;
  fees: number | null;
  currency: string | null;
  note: string | null;
  dedupe_key: string | null;
  instruments: InstrumentRef;
};

// The stored dedupe_key is either `ref:<brokerRef>` (a real broker reference) or `nat:<natural-key>`
// (no ref — we synthesized one). Only the former should re-emit a ref on export.
function refFromDedupeKey(key: string | null): string | null {
  if (key && key.startsWith("ref:")) return key.slice(4);
  return null;
}

function instrumentOf(rel: InstrumentRef): { symbol: string; exchange: string } | null {
  if (!rel) return null;
  return Array.isArray(rel) ? rel[0] ?? null : rel;
}

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  // RLS scopes transactions to the user's own portfolios automatically.
  const { data, error } = await supabase
    .from("transactions")
    .select("executed_at, type, quantity, price, fees, currency, note, dedupe_key, instruments(symbol, exchange)")
    .order("executed_at", { ascending: true });

  if (error) return new Response(error.message, { status: 500 });

  const headers = ["date", "symbol", "exchange", "type", "quantity", "price", "fees", "currency", "note", "ref"];
  const rows: CsvValue[][] = ((data ?? []) as TxRow[]).map((t) => {
    const inst = instrumentOf(t.instruments);
    return [
      t.executed_at,
      inst?.symbol ?? "",
      inst?.exchange ?? "",
      t.type,
      t.quantity,
      t.price,
      t.fees,
      t.currency,
      t.note,
      refFromDedupeKey(t.dedupe_key),
    ];
  });

  const today = new Date().toISOString().slice(0, 10);
  return csvResponse(exportFilename("transactions", today), toCsv(headers, rows));
}
