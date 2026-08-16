// Yahoo Finance provider — the free, US-first default (MARKET_DATA_PROVIDER unset or "yahoo").
// Uses the `yahoo-finance2` library. Covers US equities/ETFs + FX (and options, wired up in O1).
// US-first: US tickers pass through unchanged; a small suffix map handles common intl exchanges.
import yahooFinance from "yahoo-finance2";
import type { InstrumentMeta, MarketDataProvider, Quote } from "../types";

// The subset of yahoo-finance2's quote response we read. Cast defensively (external, dynamic).
type YahooQuoteLike = {
  regularMarketPrice?: number;
  regularMarketChangePercent?: number;
  currency?: string;
  longName?: string;
  shortName?: string;
  displayName?: string;
  quoteType?: string;
};

// Map our exchange codes to Yahoo ticker suffixes. Empty string = US (no suffix).
const YAHOO_SUFFIX: Record<string, string> = {
  US: "", USA: "", NASDAQ: "", NYSE: "", ARCA: "", BATS: "", AMEX: "",
  HK: ".HK", TSE: ".T", TYO: ".T", JPX: ".T",
  LSE: ".L", TO: ".TO", TSX: ".TO", V: ".V",
  AX: ".AX", ASX: ".AX", SI: ".SI", SGX: ".SI",
  SS: ".SS", SHG: ".SS", SZ: ".SZ", SHE: ".SZ",
  KO: ".KS", KQ: ".KQ", TW: ".TW", NS: ".NS", BO: ".BO",
};

function toYahoo(symbol: string, exchange: string): string {
  const ex = (exchange || "US").toUpperCase();
  const suffix = ex in YAHOO_SUFFIX ? YAHOO_SUFFIX[ex] : "";
  return `${symbol.toUpperCase()}${suffix}`;
}

function mapType(quoteType?: string): string {
  switch ((quoteType || "").toUpperCase()) {
    case "ETF":
      return "etf";
    case "MUTUALFUND":
      return "fund";
    case "CRYPTOCURRENCY":
      return "crypto";
    case "CURRENCY":
      return "cash";
    case "INDEX":
      return "index";
    default:
      return "stock";
  }
}

async function getQuote(symbol: string, exchange: string): Promise<Quote> {
  try {
    const q = (await yahooFinance.quote(toYahoo(symbol, exchange))) as unknown as
      | YahooQuoteLike
      | undefined;
    return {
      price: typeof q?.regularMarketPrice === "number" ? q.regularMarketPrice : null,
      currency: typeof q?.currency === "string" ? q.currency : null,
      changePct:
        typeof q?.regularMarketChangePercent === "number" ? q.regularMarketChangePercent : null,
    };
  } catch {
    return { price: null, currency: null, changePct: null };
  }
}

async function getFxRate(from: string, base: string): Promise<number> {
  if (!from || !base || from === base) return 1;
  try {
    const q = (await yahooFinance.quote(
      `${from.toUpperCase()}${base.toUpperCase()}=X`
    )) as unknown as YahooQuoteLike | undefined;
    const r = typeof q?.regularMarketPrice === "number" ? q.regularMarketPrice : NaN;
    return r && !isNaN(r) && r > 0 ? r : 1;
  } catch {
    return 1;
  }
}

async function searchInstrument(symbol: string, exchange: string): Promise<InstrumentMeta | null> {
  try {
    const q = (await yahooFinance.quote(toYahoo(symbol, exchange))) as unknown as
      | YahooQuoteLike
      | undefined;
    if (!q) return null;
    const name = q.longName || q.shortName || q.displayName || symbol;
    return {
      name,
      currency: typeof q.currency === "string" ? q.currency : "USD",
      type: mapType(q.quoteType),
    };
  } catch {
    return null;
  }
}

export const yahooProvider: MarketDataProvider = {
  name: "yahoo",
  capabilities: { options: true },
  getQuote,
  getFxRate,
  searchInstrument,
};
