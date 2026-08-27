// EODHD provider (https://eodhd.com) — the paid, licensed alternative to the unofficial Yahoo feed.
// Covers 70+ exchanges incl. US + Asian markets. Selected when MARKET_DATA_PROVIDER=eodhd.
// EODHD symbol format is SYMBOL.EXCHANGE, e.g. AAPL.US, 0700.HK, 7203.TSE.
//
// Coverage vs. the port (see the capability matrix in README.md):
//   quotes · FX · search · price history · dividend history · dividend info · profile · fund
//   breakdown  →  implemented here.
//   option chains  →  NOT available on any base EODHD plan. Options are a separate marketplace
//   add-on (Unicorn Data Services, /mp/unicornbay/options/*). `capabilities.options` stays false
//   so the port degrades honestly: features that need chains say so instead of silently returning
//   empty boards. See the note above getOptionChain before wiring it up.
import type {
  DividendHistoryPoint,
  DividendInfo,
  FundBreakdown,
  InstrumentMeta,
  InstrumentProfile,
  MarketDataProvider,
  PriceHistoryPoint,
  Quote,
} from "../types";
import { normalizeCurrency, canonicalSector } from "../normalize";

const EODHD_BASE = "https://eodhd.com/api";

function token(): string | null {
  return process.env.EODHD_API_TOKEN || null;
}

function ticker(symbol: string, exchange: string): string {
  return `${symbol.toUpperCase()}.${(exchange || "US").toUpperCase()}`;
}

// Every EODHD call goes through here: one place for the token check, the JSON parse, and the
// swallow-and-degrade contract the port expects (never throw at a caller; return the empty shape).
async function get<T>(path: string, revalidate: number): Promise<T | null> {
  const t = token();
  if (!t) return null; // no key configured — the app still runs, just without this provider
  try {
    const sep = path.includes("?") ? "&" : "?";
    const res = await fetch(`${EODHD_BASE}${path}${sep}api_token=${t}&fmt=json`, {
      next: { revalidate },
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

function num(v: unknown): number | null {
  if (v == null) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

// EODHD returns dates as plain YYYY-MM-DD strings (or with a time suffix on some fields).
function ymd(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const m = v.match(/^\d{4}-\d{2}-\d{2}/);
  return m ? m[0] : null;
}

function daysAgo(n: number): string {
  return new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
}

// --- Minor-unit handling -------------------------------------------------------------------
// Some exchanges quote in a minor unit, so prices and dividends come back 100x: London in pence,
// Johannesburg in cents, Tel Aviv in agorot. EODHD's price endpoints return no currency, and its
// fundamentals endpoint is billed at a multiple of a normal call — far too expensive to fetch per
// instrument on the nightly sync just to learn a divisor.
//
// The exchange code alone is NOT enough to answer this, which is the trap worth naming: London
// lists USD- and EUR-denominated lines (ETFs, depositary receipts) right alongside its pence-quoted
// GBP ones. Dividing those by 100 is as wrong as failing to divide a pence line, and nothing
// downstream would catch it — the result is simply a plausible number that is 100x too small.
//
// So the exchange says which currency is quoted in a minor unit, and the instrument's own stored
// currency decides whether this particular listing is that currency. A USD line on LSE divides by
// 1. Only when the caller has no stored currency to offer do we fall back to the exchange alone.
//
// This list is deliberately short. It covers the exchanges that genuinely quote in minor units —
// Hong Kong, Tokyo, Sydney, Toronto, Singapore, Mumbai and the rest all quote in major units, and
// adding them here would manufacture 100x errors where none exist.
const MINOR_UNIT_EXCHANGE: Record<string, string> = {
  LSE: "GBP", // pence (GBX/GBp)
  JSE: "ZAR", // cents (ZAc)
  TA: "ILS",  // agorot (ILa)
};

function minorUnitDivisor(exchange: string, knownCurrency?: string | null): number {
  const major = MINOR_UNIT_EXCHANGE[(exchange || "US").toUpperCase()];
  if (!major) return 1;
  // No stored currency (e.g. the very first quote for a brand-new instrument): fall back to the
  // exchange's dominant convention, which is the pence/cents line on all three of these.
  if (!knownCurrency) return 100;
  return normalizeCurrency(knownCurrency).currency === major ? 100 : 1;
}

// --- Fundamentals ------------------------------------------------------------------------------
// One endpoint feeds dividend info, profile, and fund breakdown, so cache it for a day: these
// change at most daily and a nightly sync touches each instrument once.
type Fundamentals = {
  General?: {
    Name?: string;
    Type?: string;
    CurrencyCode?: string;
    Sector?: string;
    CountryName?: string;
  };
  Highlights?: { DividendShare?: unknown; DividendYield?: unknown };
  SplitsDividends?: {
    ForwardAnnualDividendRate?: unknown;
    ForwardAnnualDividendYield?: unknown;
    ExDividendDate?: unknown;
    DividendDate?: unknown;
  };
  // ETFs carry ETF_Data; mutual funds carry the same shape under MutualFund_Data.
  ETF_Data?: { Sector_Weights?: Record<string, Record<string, string>> };
  MutualFund_Data?: { Sector_Weights?: Record<string, Record<string, string>> };
};

function fundamentals(symbol: string, exchange: string): Promise<Fundamentals | null> {
  return get<Fundamentals>(`/fundamentals/${encodeURIComponent(ticker(symbol, exchange))}`, 86_400);
}

// --- Port methods ------------------------------------------------------------------------------

async function getQuote(
  symbol: string,
  exchange: string,
  knownCurrency?: string | null
): Promise<Quote> {
  const empty: Quote = { price: null, currency: null, changePct: null };
  const d = await get<{ close?: unknown; change_p?: unknown }>(
    `/real-time/${encodeURIComponent(ticker(symbol, exchange))}`,
    60
  );
  if (!d) return empty;
  const price = num(d.close);
  const divisor = minorUnitDivisor(exchange, knownCurrency);
  return {
    price: price != null ? price / divisor : null,
    // The real-time endpoint doesn't return a currency; the instrument row carries it (set from
    // searchInstrument at add time), so leaving it null means "unchanged" rather than "USD".
    currency: null,
    changePct: num(d.change_p),
  };
}

// FX: how many units of `base` one unit of `from` is worth. Falls back to 1.
async function getFxRate(from: string, base: string): Promise<number> {
  const f = normalizeCurrency(from).currency;
  const b = normalizeCurrency(base).currency;
  if (!f || !b || f === b) return 1;
  const d = await get<{ close?: unknown }>(`/real-time/${f}${b}.FOREX`, 3600);
  const r = num(d?.close);
  return r && r > 0 ? r : 1;
}

async function searchInstrument(symbol: string, exchange: string): Promise<InstrumentMeta | null> {
  const list = await get<Array<{ Name?: string; Currency?: string; Type?: string; Exchange?: string }>>(
    `/search/${encodeURIComponent(symbol)}?limit=10`,
    86_400
  );
  if (!Array.isArray(list) || !list.length) return null;
  const want = (exchange || "US").toUpperCase();
  const match = list.find((x) => (x.Exchange || "").toUpperCase() === want) ?? list[0];
  if (!match) return null;
  return {
    name: match.Name || symbol,
    currency: normalizeCurrency(match.Currency).currency,
    type: mapType(match.Type),
  };
}

// EODHD's Type strings are free-form ("Common Stock", "ETF", "Mutual Fund", "Currency", "INDEX").
// Map onto the app's vocabulary (stock | etf | fund | crypto | cash | index).
function mapType(raw?: string): string {
  const t = (raw || "").toLowerCase();
  if (t.includes("etf")) return "etf";
  if (t.includes("fund")) return "fund";
  if (t.includes("currency") || t.includes("forex")) return "cash";
  if (t.includes("crypto")) return "crypto";
  if (t.includes("index")) return "index";
  return "stock";
}

async function getDividendInfo(symbol: string, exchange: string): Promise<DividendInfo | null> {
  const f = await fundamentals(symbol, exchange);
  if (!f) return null;
  const sd = f.SplitsDividends ?? {};
  const hl = f.Highlights ?? {};
  const { divisor } = normalizeCurrency(f.General?.CurrencyCode);

  const rawRate = num(sd.ForwardAnnualDividendRate) ?? num(hl.DividendShare);
  const rawYield = num(sd.ForwardAnnualDividendYield) ?? num(hl.DividendYield);
  // The port's contract is a percent. EODHD documents yields as fractions (0.0234 = 2.34%), but
  // that is the one field shape here we could not verify against a live response, and getting it
  // wrong by 100x would be exactly the "confident wrong number" the product forbids. A real
  // dividend yield never exceeds 1 as a fraction and never sits below 1 as a percent for a payer,
  // so treat >1 as already-a-percent and only scale genuine fractions.
  const yieldTtm = rawYield == null ? null : rawYield > 1 ? rawYield : rawYield * 100;

  return {
    annualDividendPerShare: rawRate != null ? rawRate / divisor : null,
    yieldTtm,
    exDividendDate: ymd(sd.ExDividendDate),
    nextDividendDate: ymd(sd.DividendDate),
  };
}

async function getDividendHistory(
  symbol: string,
  exchange: string
): Promise<DividendHistoryPoint[]> {
  // ~3 years back, matching the Yahoo provider, so dividend-safety scoring sees the same window.
  const rows = await get<Array<{ date?: string; value?: unknown; currency?: string }>>(
    `/div/${encodeURIComponent(ticker(symbol, exchange))}?from=${daysAgo(3 * 365)}`,
    86_400
  );
  if (!Array.isArray(rows)) return [];
  const out: DividendHistoryPoint[] = [];
  for (const r of rows) {
    const exDate = ymd(r.date);
    const amount = num(r.value);
    if (!exDate || amount == null) continue;
    // Per-row currency: an LSE payout comes back in pence even when the listing is quoted in GBP.
    const { divisor } = normalizeCurrency(r.currency);
    out.push({ exDate, amount: amount / divisor });
  }
  out.sort((a, b) => a.exDate.localeCompare(b.exDate));
  return out;
}

async function getPriceHistory(
  symbol: string,
  exchange: string,
  fromDays: number,
  knownCurrency?: string | null
): Promise<PriceHistoryPoint[]> {
  // Weekly bars (period=w) to match the Yahoo provider: ~52 points/year per instrument, light to
  // store and to draw. adjusted_close so splits don't put a false cliff in the value chart.
  const rows = await get<Array<{ date?: string; close?: unknown; adjusted_close?: unknown }>>(
    `/eod/${encodeURIComponent(ticker(symbol, exchange))}?period=w&from=${daysAgo(fromDays)}`,
    86_400
  );
  if (!Array.isArray(rows)) return [];
  const divisor = minorUnitDivisor(exchange, knownCurrency);
  const out: PriceHistoryPoint[] = [];
  for (const r of rows) {
    const date = ymd(r.date);
    const close = num(r.adjusted_close) ?? num(r.close);
    if (!date || close == null) continue;
    out.push({ date, close: close / divisor });
  }
  out.sort((a, b) => a.date.localeCompare(b.date));
  return out;
}

async function getProfile(symbol: string, exchange: string): Promise<InstrumentProfile | null> {
  const f = await fundamentals(symbol, exchange);
  const g = f?.General;
  if (!g) return null;
  const sector = typeof g.Sector === "string" && g.Sector ? canonicalSector(g.Sector) : null;
  const country = typeof g.CountryName === "string" && g.CountryName ? g.CountryName : null;
  if (!sector && !country) return null;
  return { sector, country };
}

async function getFundBreakdown(symbol: string, exchange: string): Promise<FundBreakdown | null> {
  const f = await fundamentals(symbol, exchange);
  const weights = f?.ETF_Data?.Sector_Weights ?? f?.MutualFund_Data?.Sector_Weights;
  if (!weights) return null;
  const sectorWeights: { sector: string; weight: number }[] = [];
  for (const [sector, detail] of Object.entries(weights)) {
    // Shape: { "Technology": { "Equity_%": "31.23", "Relative_to_Category": "…" } } — a percent
    // string. The port's contract is a fraction (Yahoo returns 0.31), so divide by 100.
    const pct = num(detail?.["Equity_%"]);
    if (pct == null || pct <= 0) continue;
    sectorWeights.push({ sector: canonicalSector(sector), weight: pct / 100 });
  }
  return sectorWeights.length ? { sectorWeights } : null;
}

// NOTE — option chains are deliberately NOT implemented.
// EODHD sells US options as a separate marketplace add-on (Unicorn Data Services:
// /mp/unicornbay/options/contracts and /mp/unicornbay/options/eod), not as part of any base plan
// including All-In-One. Implementing it blind would mean flipping capabilities.options to true and
// guessing a response schema we cannot test — which would silently return empty option boards to
// the cockpit, wheel, and put finder instead of failing loudly. That is the exact "confident wrong
// number" this product forbids.
// To finish it: subscribe to the add-on, then implement getOptionChain against the real payload
// (contracts endpoint gives strike/expiration/bid/ask/IV/open interest for ~6,000 US names) and
// flip capabilities.options to true in the same commit.

export const eodhdProvider: MarketDataProvider = {
  name: "eodhd",
  capabilities: { options: false },
  getQuote,
  getFxRate,
  searchInstrument,
  getDividendInfo,
  getDividendHistory,
  getPriceHistory,
  getProfile,
  getFundBreakdown,
};
