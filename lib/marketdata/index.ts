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

// Get conversion rates for a set of currencies into the base currency (rates fall back to 1).
export async function getRates(
  currencies: string[],
  base: string
): Promise<Record<string, number>> {
  const provider = getProvider();
  const uniq = [...new Set(currencies.filter(Boolean))];
  const out: Record<string, number> = {};
  await Promise.all(
    uniq.map(async (c) => {
      out[c] = await provider.getFxRate(c, base);
    })
  );
  return out;
}
