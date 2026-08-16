// Yahoo Finance provider — the free, US-first default (MARKET_DATA_PROVIDER unset or "yahoo").
// Uses the `yahoo-finance2` library. Covers US equities/ETFs + FX (and options, wired up in O1).
// US-first: US tickers pass through unchanged; a small suffix map handles common intl exchanges.
import YahooFinance from "yahoo-finance2";
import type {
  DividendHistoryPoint,
  DividendInfo,
  InstrumentMeta,
  MarketDataProvider,
  Quote,
} from "../types";

// v4 is class-based: instantiate once (server-only; construction is side-effect-free) and reuse.
const yf = new YahooFinance();

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
    const q = (await yf.quote(toYahoo(symbol, exchange))) as unknown as
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
    const q = (await yf.quote(
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
    const q = (await yf.quote(toYahoo(symbol, exchange))) as unknown as
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

type YahooSummaryDetailLike = {
  dividendRate?: number;
  dividendYield?: number;
  trailingAnnualDividendRate?: number;
  trailingAnnualDividendYield?: number;
  exDividendDate?: Date;
};
type YahooCalendarEventsLike = { exDividendDate?: Date; dividendDate?: Date };
type YahooQuoteSummaryLike = {
  summaryDetail?: YahooSummaryDetailLike;
  calendarEvents?: YahooCalendarEventsLike;
};

function isoDate(d: Date | undefined | null): string | null {
  if (!d) return null;
  const t = d instanceof Date ? d : new Date(d);
  if (isNaN(t.getTime())) return null;
  const m = String(t.getMonth() + 1).padStart(2, "0");
  const day = String(t.getDate()).padStart(2, "0");
  return `${t.getFullYear()}-${m}-${day}`;
}

async function getDividendInfo(symbol: string, exchange: string): Promise<DividendInfo | null> {
  try {
    const res = (await yf.quoteSummary(toYahoo(symbol, exchange), {
      modules: ["summaryDetail", "calendarEvents"],
    })) as unknown as YahooQuoteSummaryLike;
    const sd = res?.summaryDetail;
    const ce = res?.calendarEvents;
    const rate =
      typeof sd?.dividendRate === "number"
        ? sd.dividendRate
        : typeof sd?.trailingAnnualDividendRate === "number"
          ? sd.trailingAnnualDividendRate
          : null;
    const yieldFrac =
      typeof sd?.dividendYield === "number"
        ? sd.dividendYield
        : typeof sd?.trailingAnnualDividendYield === "number"
          ? sd.trailingAnnualDividendYield
          : null;
    return {
      annualDividendPerShare: rate,
      yieldTtm: yieldFrac != null ? yieldFrac * 100 : null,
      exDividendDate: isoDate(sd?.exDividendDate ?? ce?.exDividendDate),
      nextDividendDate: isoDate(ce?.dividendDate),
    };
  } catch {
    return null;
  }
}

async function getDividendHistory(
  symbol: string,
  exchange: string
): Promise<DividendHistoryPoint[]> {
  try {
    const period1 = new Date(Date.now() - 3 * 365 * 24 * 60 * 60 * 1000); // ~3 years back
    const res = (await yf.chart(toYahoo(symbol, exchange), {
      period1,
      interval: "1mo",
      events: "div",
    })) as unknown as { events?: { dividends?: Array<{ date?: Date; amount?: number }> } };
    const out: DividendHistoryPoint[] = [];
    for (const d of res?.events?.dividends ?? []) {
      const iso = isoDate(d?.date ?? null);
      if (iso && typeof d?.amount === "number") out.push({ exDate: iso, amount: d.amount });
    }
    // Chronological (oldest → newest) so callers can take the last as most recent.
    out.sort((a, b) => a.exDate.localeCompare(b.exDate));
    return out;
  } catch {
    return [];
  }
}

export const yahooProvider: MarketDataProvider = {
  name: "yahoo",
  capabilities: { options: true },
  getQuote,
  getFxRate,
  searchInstrument,
  getDividendInfo,
  getDividendHistory,
};
