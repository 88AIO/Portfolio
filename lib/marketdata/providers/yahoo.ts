// Yahoo Finance provider — the free, US-first default (MARKET_DATA_PROVIDER unset or "yahoo").
// Uses the `yahoo-finance2` library. Covers US equities/ETFs + FX (and options, wired up in O1).
// US-first: US tickers pass through unchanged; a small suffix map handles common intl exchanges.
import YahooFinance from "yahoo-finance2";
import type {
  DividendHistoryPoint,
  DividendInfo,
  FundBreakdown,
  InstrumentMeta,
  InstrumentProfile,
  MarketDataProvider,
  OptionChain,
  OptionContract,
  OptionQuote,
  PriceHistoryPoint,
  Quote,
} from "../types";

// v4 is class-based: instantiate once (server-only; construction is side-effect-free) and reuse.
const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] });

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
  KL: ".KL", KLSE: ".KL", BK: ".BK", SET: ".BK",
};

function toYahoo(symbol: string, exchange: string): string {
  const ex = (exchange || "US").toUpperCase();
  const sym = symbol.toUpperCase();
  // Crypto quotes on Yahoo are SYMBOL-USD (e.g. BTC-USD), not the equity suffix scheme.
  if (ex === "CRYPTO" || ex === "CC") return `${sym.replace(/-USD$/, "")}-USD`;
  const suffix = ex in YAHOO_SUFFIX ? YAHOO_SUFFIX[ex] : "";
  return `${sym}${suffix}`;
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

// Yahoo quotes some markets in a currency's *minor* unit — London in pence (currency "GBp"),
// Johannesburg in cents ("ZAc"), Tel Aviv in agorot ("ILA"). Left as-is, a £42.00 share arrives
// as 4200 "GBp", its FX pair "GBpUSD=X" won't resolve (→ silent 1.0), and the holding reads ~100×
// too large. Normalize to the major ISO unit (÷100) so prices, dividends, and FX all agree.
const MINOR_UNIT: Record<string, string> = { GBP: "GBP", GBX: "GBP", ZAC: "ZAR", ILA: "ILS" };
function normalizeCurrency(raw: string | null | undefined): { currency: string; divisor: number } {
  if (!raw) return { currency: "USD", divisor: 1 };
  // The tell for a minor-unit quote is a lowercase trailing letter (GBp, ZAc, ILa).
  const isMinor = /[a-z]$/.test(raw) && MINOR_UNIT[raw.toUpperCase()] != null;
  if (isMinor) return { currency: MINOR_UNIT[raw.toUpperCase()], divisor: 100 };
  return { currency: raw.toUpperCase(), divisor: 1 };
}

async function getQuote(symbol: string, exchange: string): Promise<Quote> {
  try {
    const q = (await yf.quote(toYahoo(symbol, exchange))) as unknown as
      | YahooQuoteLike
      | undefined;
    const { currency, divisor } = normalizeCurrency(q?.currency);
    const rawPrice = typeof q?.regularMarketPrice === "number" ? q.regularMarketPrice : null;
    return {
      price: rawPrice != null ? rawPrice / divisor : null,
      currency: typeof q?.currency === "string" ? currency : null,
      changePct:
        typeof q?.regularMarketChangePercent === "number" ? q.regularMarketChangePercent : null,
    };
  } catch {
    return { price: null, currency: null, changePct: null };
  }
}

async function getFxRate(from: string, base: string): Promise<number> {
  const f = normalizeCurrency(from).currency;
  const b = normalizeCurrency(base).currency;
  if (!f || !b || f === b) return 1;
  try {
    const q = (await yf.quote(`${f}${b}=X`)) as unknown as YahooQuoteLike | undefined;
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
      currency: typeof q.currency === "string" ? normalizeCurrency(q.currency).currency : "USD",
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
  price?: { currency?: string };
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
      modules: ["summaryDetail", "calendarEvents", "price"],
    })) as unknown as YahooQuoteSummaryLike;
    const sd = res?.summaryDetail;
    const ce = res?.calendarEvents;
    const { divisor } = normalizeCurrency(res?.price?.currency);
    const rawRate =
      typeof sd?.dividendRate === "number"
        ? sd.dividendRate
        : typeof sd?.trailingAnnualDividendRate === "number"
          ? sd.trailingAnnualDividendRate
          : null;
    const rate = rawRate != null ? rawRate / divisor : null;
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
    // Daily interval so high-frequency (weekly) distribution funds — XDTE/YMAX/QDTE etc. —
    // return every payout; a monthly interval collapses weekly dividends and undercounts income.
    const res = (await yf.chart(toYahoo(symbol, exchange), {
      period1,
      interval: "1d",
      events: "div",
    })) as unknown as {
      meta?: { currency?: string };
      events?: { dividends?: Array<{ date?: Date; amount?: number }> };
    };
    const { divisor } = normalizeCurrency(res?.meta?.currency);
    const out: DividendHistoryPoint[] = [];
    for (const d of res?.events?.dividends ?? []) {
      const iso = isoDate(d?.date ?? null);
      if (iso && typeof d?.amount === "number") out.push({ exDate: iso, amount: d.amount / divisor });
    }
    // Chronological (oldest → newest) so callers can take the last as most recent.
    out.sort((a, b) => a.exDate.localeCompare(b.exDate));
    return out;
  } catch {
    return [];
  }
}

async function getPriceHistory(
  symbol: string,
  exchange: string,
  fromDays: number
): Promise<PriceHistoryPoint[]> {
  try {
    const period1 = new Date(Date.now() - fromDays * 24 * 60 * 60 * 1000);
    // Weekly bars keep ~1 year to ~52 points per instrument — light to store and to draw.
    const res = (await yf.chart(toYahoo(symbol, exchange), {
      period1,
      interval: "1wk",
    })) as unknown as {
      meta?: { currency?: string };
      quotes?: Array<{ date?: Date; close?: number | null; adjclose?: number | null }>;
    };
    const { divisor } = normalizeCurrency(res?.meta?.currency);
    const out: PriceHistoryPoint[] = [];
    for (const q of res?.quotes ?? []) {
      const iso = isoDate(q?.date ?? null);
      const close = q?.adjclose ?? q?.close;
      if (iso && typeof close === "number" && Number.isFinite(close)) out.push({ date: iso, close: close / divisor });
    }
    out.sort((a, b) => a.date.localeCompare(b.date));
    return out;
  } catch {
    return [];
  }
}

async function getProfile(symbol: string, exchange: string): Promise<InstrumentProfile | null> {
  try {
    const res = (await yf.quoteSummary(toYahoo(symbol, exchange), {
      modules: ["assetProfile"],
    })) as unknown as { assetProfile?: { sector?: string; country?: string } };
    const ap = res?.assetProfile;
    if (!ap) return null;
    return {
      sector: typeof ap.sector === "string" ? ap.sector : null,
      country: typeof ap.country === "string" ? ap.country : null,
    };
  } catch {
    return null;
  }
}

// Yahoo's fund sectorWeightings use snake_case keys; map them to the same human labels
// Yahoo's assetProfile uses for individual stocks, so ETF look-through and stock sectors
// land in the SAME buckets on the allocation chart.
const FUND_SECTOR_LABEL: Record<string, string> = {
  realestate: "Real Estate",
  consumer_cyclical: "Consumer Cyclical",
  basic_materials: "Basic Materials",
  consumer_defensive: "Consumer Defensive",
  technology: "Technology",
  communication_services: "Communication Services",
  financial_services: "Financial Services",
  utilities: "Utilities",
  industrials: "Industrials",
  energy: "Energy",
  healthcare: "Healthcare",
};

async function getFundBreakdown(symbol: string, exchange: string): Promise<FundBreakdown | null> {
  try {
    const res = (await yf.quoteSummary(toYahoo(symbol, exchange), {
      modules: ["topHoldings"],
    })) as unknown as {
      topHoldings?: { sectorWeightings?: Array<Record<string, number>> };
    };
    const weightings = res?.topHoldings?.sectorWeightings;
    if (!weightings || !weightings.length) return null;
    const sectorWeights: { sector: string; weight: number }[] = [];
    for (const entry of weightings) {
      // Each entry is a single-key object, e.g. { technology: 0.31 }.
      const key = Object.keys(entry)[0];
      const weight = entry[key];
      if (!key || typeof weight !== "number" || weight <= 0) continue;
      sectorWeights.push({ sector: FUND_SECTOR_LABEL[key] ?? key, weight });
    }
    return sectorWeights.length ? { sectorWeights } : null;
  } catch {
    return null;
  }
}

// --- Options (free US chains via yahoo-finance2's `options` endpoint) ---
type YahooOptionLeg = {
  strike?: number;
  lastPrice?: number;
  bid?: number;
  ask?: number;
  impliedVolatility?: number;
  openInterest?: number;
};
type YahooOptionsResult = {
  expirationDates?: Date[];
  options?: Array<{ expirationDate?: Date; calls?: YahooOptionLeg[]; puts?: YahooOptionLeg[] }>;
};

function numOrNull(v: unknown): number | null {
  return typeof v === "number" && !isNaN(v) ? v : null;
}
// Mark = mid of bid/ask when both are live, else the last traded price.
function markOf(o: YahooOptionLeg): number | null {
  const bid = numOrNull(o.bid);
  const ask = numOrNull(o.ask);
  if (bid != null && ask != null && (bid > 0 || ask > 0)) return (bid + ask) / 2;
  return numOrNull(o.lastPrice);
}

async function getOptionChain(
  underlying: string,
  exchange: string,
  expiration?: string
): Promise<OptionChain> {
  const ticker = toYahoo(underlying, exchange);
  const empty: OptionChain = {
    underlying: underlying.toUpperCase(),
    expiration: null,
    expirations: [],
    contracts: [],
  };
  try {
    const query = expiration ? { date: new Date(`${expiration}T00:00:00Z`) } : undefined;
    const res = (await yf.options(ticker, query)) as unknown as YahooOptionsResult;
    const expirations = (res?.expirationDates ?? [])
      .map((d) => isoDate(d))
      .filter((x): x is string => !!x);
    const board = res?.options?.[0];
    const expIso = isoDate(board?.expirationDate ?? null) ?? expiration ?? null;
    const map = (type: "put" | "call", arr?: YahooOptionLeg[]): OptionContract[] =>
      (arr ?? [])
        .filter((o) => typeof o.strike === "number")
        .map((o) => ({
          type,
          strike: o.strike as number,
          expiration: expIso ?? "",
          mark: markOf(o),
          bid: numOrNull(o.bid),
          ask: numOrNull(o.ask),
          iv: numOrNull(o.impliedVolatility),
          openInterest: numOrNull(o.openInterest),
        }));
    return {
      underlying: underlying.toUpperCase(),
      expiration: expIso,
      expirations,
      contracts: [...map("call", board?.calls), ...map("put", board?.puts)],
    };
  } catch {
    return empty;
  }
}

async function getOptionQuote(
  underlying: string,
  exchange: string,
  type: "put" | "call",
  strike: number,
  expiration: string
): Promise<OptionQuote> {
  const chain = await getOptionChain(underlying, exchange, expiration);
  const hit = chain.contracts.find((c) => c.type === type && Math.abs(c.strike - strike) < 1e-6);
  if (!hit) return { mark: null, bid: null, ask: null, iv: null, openInterest: null };
  return { mark: hit.mark, bid: hit.bid, ask: hit.ask, iv: hit.iv, openInterest: hit.openInterest };
}

export const yahooProvider: MarketDataProvider = {
  name: "yahoo",
  capabilities: { options: true },
  getQuote,
  getFxRate,
  searchInstrument,
  getDividendInfo,
  getDividendHistory,
  getPriceHistory,
  getProfile,
  getFundBreakdown,
  getOptionChain,
  getOptionQuote,
};
