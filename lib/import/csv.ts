// CSV parsing + normalization for transaction import (server-side).
// Forgiving by design: case-insensitive headers, common aliases, and lenient number/date parsing.
import Papa from "papaparse";
import type { ParseResult, ParsedRow, RowError } from "./types";

// Map common broker/export header names onto our canonical fields.
const HEADER_ALIASES: Record<string, string> = {
  ticker: "symbol",
  symbol: "symbol",
  exchange: "exchange",
  market: "exchange",
  type: "type",
  action: "type",
  side: "type",
  quantity: "quantity",
  qty: "quantity",
  shares: "quantity",
  units: "quantity",
  price: "price",
  unitprice: "price",
  fees: "fees",
  fee: "fees",
  commission: "fees",
  commissions: "fees",
  currency: "currency",
  ccy: "currency",
  date: "executed_at",
  executed_at: "executed_at",
  tradedate: "executed_at",
  note: "note",
  notes: "note",
  memo: "note",
  description: "note",
  ref: "ref",
  id: "ref",
  reference: "ref",
  transactionid: "ref",
};

const TYPE_ALIASES: Record<string, string> = {
  buy: "buy",
  bought: "buy",
  purchase: "buy",
  b: "buy",
  sell: "sell",
  sold: "sell",
  sale: "sell",
  s: "sell",
  dividend: "dividend",
  dividends: "dividend",
  div: "dividend",
  deposit: "deposit",
  withdrawal: "withdrawal",
  withdraw: "withdrawal",
};

function normalizeHeader(h: string): string {
  const k = h.trim().toLowerCase().replace(/\s+/g, "");
  return HEADER_ALIASES[k] ?? k;
}

function toNumber(v: string): number {
  const s = v.replace(/[^0-9.\-]/g, "");
  if (s === "" || s === "-" || s === ".") return NaN;
  return Number(s);
}

// Accept ISO (YYYY-MM-DD) directly; otherwise parse and reformat. Returns null if unparseable.
function toIsoDate(s: string): string | null {
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(s);
  if (isNaN(d.getTime())) return null;
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

export function parseTransactionsCsv(text: string): ParseResult {
  const rows: ParsedRow[] = [];
  const errors: RowError[] = [];

  const parsed = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: normalizeHeader,
  });

  parsed.data.forEach((raw, i) => {
    const line = i + 2; // +1 header row, +1 for 1-based numbering
    const get = (k: string) => (raw[k] ?? "").toString().trim();

    const symbol = get("symbol").toUpperCase();
    if (!symbol) {
      // Ignore truly blank lines; flag lines that have data but no symbol.
      if (Object.values(raw).some((v) => (v ?? "").toString().trim() !== "")) {
        errors.push({ line, message: "Missing symbol" });
      }
      return;
    }

    const rawType = get("type").toLowerCase();
    const type = rawType ? TYPE_ALIASES[rawType] : "buy";
    if (!type) {
      errors.push({ line, message: `Unknown type "${rawType}"` });
      return;
    }

    const quantity = toNumber(get("quantity"));
    if (!isFinite(quantity) || quantity <= 0) {
      errors.push({ line, message: "Quantity must be a positive number" });
      return;
    }

    const priceStr = get("price");
    const price = priceStr ? toNumber(priceStr) : 0;
    if (!isFinite(price) || price < 0) {
      errors.push({ line, message: "Invalid price" });
      return;
    }

    const feesStr = get("fees");
    const fees = feesStr ? toNumber(feesStr) : 0;
    if (!isFinite(fees) || fees < 0) {
      errors.push({ line, message: "Invalid fees" });
      return;
    }

    const dateStr = get("executed_at");
    const executed_at = dateStr ? toIsoDate(dateStr) : null;
    if (dateStr && !executed_at) {
      errors.push({ line, message: `Unrecognized date "${dateStr}"` });
      return;
    }

    rows.push({
      line,
      symbol,
      exchange: (get("exchange") || "US").toUpperCase(),
      type,
      quantity,
      price,
      fees,
      currency: get("currency").toUpperCase() || null,
      executed_at,
      note: get("note") || null,
      ref: get("ref") || null,
    });
  });

  return { rows, errors };
}

// Stable idempotency key: prefer the broker ref; otherwise a natural key of the trade's identity.
export function transactionDedupeKey(t: {
  ref: string | null;
  type: string;
  instrument_id: string;
  executed_at: string;
  quantity: number;
  price: number;
  fees: number;
}): string {
  if (t.ref) return `ref:${t.ref}`;
  return `nat:${t.type}|${t.instrument_id}|${t.executed_at}|${t.quantity}|${t.price}|${t.fees}`;
}
