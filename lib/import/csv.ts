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

// Guardrails so a user-supplied ticker can't create junk instrument rows or drive unbounded
// provider calls via the service-role client. Tickers are short and use a limited charset
// (letters, digits, dot, hyphen — covers BRK.B, class shares, crypto pairs, most intl symbols).
export function isValidSymbol(s: string): boolean {
  return /^[A-Z0-9.\-]{1,15}$/.test(s);
}
export function isValidExchange(s: string): boolean {
  return /^[A-Z0-9.\-]{1,10}$/.test(s);
}

// Import limits — bound memory, DB round-trips, and the post-import provider fan-out.
export const IMPORT_MAX_BYTES = 2_000_000; // 2 MB
export const IMPORT_MAX_ROWS = 5_000;
export const IMPORT_MAX_SYMBOLS = 500;

function normalizeHeader(h: string): string {
  const k = h.trim().toLowerCase().replace(/\s+/g, "");
  return HEADER_ALIASES[k] ?? k;
}

// Locales disagree about which of "." and "," is the decimal point, and getting it backwards is
// silent: "1.234,56" (European for 1234.56) read as 1.23456 is a ~1000x error that no downstream
// validation rejects, because 1.23456 is still a plausible price.
function toNumber(v: string): number {
  let s = v.trim();
  if (!s) return NaN;

  // Accounting notation: (1,234.56) means negative.
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1).trim();
  }

  // Drop currency symbols and spaces — including the thin/non-breaking spaces several locales use
  // as the thousands separator.
  s = s.replace(/[^\d.,+-]/g, "");
  if (s.startsWith("-")) {
    negative = !negative;
    s = s.slice(1);
  } else if (s.startsWith("+")) {
    s = s.slice(1);
  }
  if (/[+-]/.test(s)) return NaN; // a sign mid-number is not something to guess at

  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  if (lastComma !== -1 && lastDot !== -1) {
    // Both present: the RIGHTMOST separator is the decimal point, the other groups thousands.
    s = lastComma > lastDot ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  } else if (lastComma !== -1) {
    // Commas only, and genuinely ambiguous in isolation: "1,234" is 1234 in the US and 1.234 in
    // much of Europe. Three trailing digits (or more than one comma) reads as thousands groups,
    // matching the US-first default; anything else ("99,95") is a decimal comma.
    const groups = s.split(",");
    const grouped = groups.length > 2 || groups[groups.length - 1].length === 3;
    s = grouped ? s.replace(/,/g, "") : s.replace(",", ".");
  }

  if (s === "" || s === ".") return NaN;
  const n = Number(s);
  if (!Number.isFinite(n)) return NaN;
  return negative ? -n : n;
}

// Accept ISO (YYYY-MM-DD) directly; otherwise parse and reformat. Returns null if unparseable.
function toIsoDate(s: string): string | null {
  const t = s.trim();

  // An ISO date states a calendar day, so take it verbatim — with or without a time suffix.
  // Routing "2024-01-15T00:00:00Z" through Date would re-read it as an instant, and the local
  // getters below would then report Jan 14 anywhere west of UTC: a trade silently moved a day,
  // and at a year boundary moved into the wrong tax year. Production runs in UTC, which hides
  // this; a user's own machine would not.
  const iso = t.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s].*)?$/);
  if (iso) {
    const [, y, mo, d] = iso;
    const probe = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d)));
    const real =
      probe.getUTCFullYear() === Number(y) &&
      probe.getUTCMonth() === Number(mo) - 1 &&
      probe.getUTCDate() === Number(d);
    return real ? `${y}-${mo}-${d}` : null; // rejects 2024-13-45 rather than passing it on
  }

  // Everything else ("03/15/2024", "Mar 15, 2024") carries no timezone, so Date reads it as local
  // midnight and the local getters read it back unchanged.
  const d = new Date(t);
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

  // Whether the file declares a type column at all — a blank cell means something different in a
  // file that has one than in a bare holdings list.
  const hasTypeColumn = (parsed.meta?.fields ?? []).includes("type");

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
    let type: string;
    if (!rawType) {
      // No type column anywhere → a plain holdings list, so "buy" is the sensible reading. But a
      // BLANK cell in a file that DOES declare the column is missing data, and defaulting it
      // invents a purchase the user never made — the kind of wrong number that only surfaces
      // later, in their cost basis.
      if (hasTypeColumn) {
        errors.push({ line, message: "Missing type" });
        return;
      }
      type = "buy";
    } else {
      const mapped = TYPE_ALIASES[rawType];
      if (!mapped) {
        errors.push({ line, message: `Unknown type "${rawType}"` });
        return;
      }
      type = mapped;
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
