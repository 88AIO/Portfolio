// Market-data provider port (public entry point).
// The app imports getQuote / getFxRate / getRates / searchInstrument from "@/lib/marketdata"
// and never talks to a data vendor directly. Choose the vendor with the MARKET_DATA_PROVIDER
// env var: default "yahoo" (free, US-first) or "eodhd" (paid, wider coverage).
// See docs/MARKET_DATA_ADAPTER.md.
import type { MarketDataProvider } from "./types";
import { yahooProvider } from "./providers/yahoo";
import { eodhdProvider } from "./providers/eodhd";

export type {
  Quote,
  InstrumentMeta,
  DividendInfo,
  DividendHistoryPoint,
  PriceHistoryPoint,
  InstrumentProfile,
  FundBreakdown,
  OptionQuote,
  OptionContract,
  OptionChain,
  ProviderCapabilities,
  MarketDataProvider,
} from "./types";

const PROVIDERS: Record<string, MarketDataProvider> = {
  yahoo: yahooProvider,
  eodhd: eodhdProvider,
};

export function getProvider(): MarketDataProvider {
  const key = (process.env.MARKET_DATA_PROVIDER || "yahoo").toLowerCase();
  return PROVIDERS[key] ?? yahooProvider;
}

export function getQuote(symbol: string, exchange: string) {
  return getProvider().getQuote(symbol, exchange);
}

export function getFxRate(from: string, base: string) {
  return getProvider().getFxRate(from, base);
}

export function searchInstrument(symbol: string, exchange: string) {
  return getProvider().searchInstrument(symbol, exchange);
}

export function getDividendInfo(symbol: string, exchange: string) {
  const provider = getProvider();
  return provider.getDividendInfo ? provider.getDividendInfo(symbol, exchange) : Promise.resolve(null);
}

export function getDividendHistory(symbol: string, exchange: string) {
  const provider = getProvider();
  return provider.getDividendHistory ? provider.getDividendHistory(symbol, exchange) : Promise.resolve([]);
}

export function getPriceHistory(symbol: string, exchange: string, fromDays: number) {
  const provider = getProvider();
  return provider.getPriceHistory
    ? provider.getPriceHistory(symbol, exchange, fromDays)
    : Promise.resolve([]);
}

export function getProfile(symbol: string, exchange: string) {
  const provider = getProvider();
  return provider.getProfile ? provider.getProfile(symbol, exchange) : Promise.resolve(null);
}

export function getFundBreakdown(symbol: string, exchange: string) {
  const provider = getProvider();
  return provider.getFundBreakdown ? provider.getFundBreakdown(symbol, exchange) : Promise.resolve(null);
}

export function providerSupportsOptions(): boolean {
  return getProvider().capabilities.options === true;
}

export function getOptionChain(underlying: string, exchange: string, expiration?: string) {
  const provider = getProvider();
  return provider.getOptionChain
    ? provider.getOptionChain(underlying, exchange, expiration)
    : Promise.resolve(null);
}

export function getOptionQuote(
  underlying: string,
  exchange: string,
  type: "put" | "call",
  strike: number,
  expiration: string
) {
  const provider = getProvider();
  return provider.getOptionQuote
    ? provider.getOptionQuote(underlying, exchange, type, strike, expiration)
    : Promise.resolve(null);
}

// Approximate <currency>→USD rates, used ONLY when the live FX lookup fails. Returning a silent 1.0
// for e.g. HKD (really ~0.128) would treat a Hong Kong holding as if it were US dollars — an ~8×
// overstatement. A rough-but-right fallback is far more honest than 1:1; it's the safety net, not the
// source (the nightly/live rate is preferred whenever it resolves).
const FALLBACK_USD_RATE: Record<string, number> = {
  HKD: 0.1282, SGD: 0.78, TWD: 0.0322, MYR: 0.212, CNH: 0.14, CNY: 0.14,
  JPY: 0.0067, KRW: 0.00072, INR: 0.0116, THB: 0.028, GBP: 1.27, EUR: 1.08,
  CAD: 0.73, AUD: 0.66, CHF: 1.12, HUF: 0.0028,
};

// Get conversion rates for a set of currencies into the base currency. Live rate first; on failure
// (provider returned 1 for a non-base currency, i.e. it couldn't resolve the pair) fall back to a
// known approximate rather than a catastrophic 1:1. Fallbacks are USD-based, so they only apply when
// the base is USD (the app default).
export async function getRates(
  currencies: string[],
  base: string
): Promise<Record<string, number>> {
  const provider = getProvider();
  const uniq = [...new Set(currencies.filter(Boolean))];
  const baseUpper = (base || "USD").toUpperCase();
  const out: Record<string, number> = {};
  await Promise.all(
    uniq.map(async (c) => {
      let rate = 1;
      try {
        rate = await provider.getFxRate(c, base);
      } catch {
        rate = 1;
      }
      const cu = c.toUpperCase();
      // A rate of exactly 1 for a different currency means the live lookup didn't resolve — use the
      // approximate fallback when we have one (USD base only).
      if ((!rate || rate === 1) && cu !== baseUpper && baseUpper === "USD" && FALLBACK_USD_RATE[cu]) {
        rate = FALLBACK_USD_RATE[cu];
      }
      out[c] = rate && rate > 0 ? rate : 1;
    })
  );
  return out;
}
