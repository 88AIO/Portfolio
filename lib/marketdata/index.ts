// Market-data provider port (public entry point).
// The app imports getQuote / getFxRate / searchInstrument etc. from "@/lib/marketdata"
// and never talks to a data vendor directly. Choose the vendor with the MARKET_DATA_PROVIDER
// env var: default "yahoo" (free, US-first) or "eodhd" (paid, wider coverage).
// FX conversion for pages/crons lives in lib/fx.ts (cached fx_rates table + fallback);
// this module only exposes the raw per-pair getFxRate the nightly sync feeds it with.
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

// Count every provider round trip made in this process. Within one serverless invocation this is
// exactly that run's vendor-call total — the nightly cron reads (and resets) it into its recorded
// summary, the only usage number we have for the free Yahoo feed until a paid provider's dashboard
// exists. Cheap, in-memory, best-effort by nature.
let providerCalls = 0;
function counted<T>(p: Promise<T>): Promise<T> {
  providerCalls++;
  return p;
}
export function takeProviderCallCount(): number {
  const n = providerCalls;
  providerCalls = 0;
  return n;
}

export function getQuote(symbol: string, exchange: string) {
  return counted(getProvider().getQuote(symbol, exchange));
}

export function getFxRate(from: string, base: string) {
  return counted(getProvider().getFxRate(from, base));
}

export function searchInstrument(symbol: string, exchange: string) {
  return counted(getProvider().searchInstrument(symbol, exchange));
}

export function getDividendInfo(symbol: string, exchange: string) {
  const provider = getProvider();
  return provider.getDividendInfo ? counted(provider.getDividendInfo(symbol, exchange)) : Promise.resolve(null);
}

export function getDividendHistory(symbol: string, exchange: string) {
  const provider = getProvider();
  return provider.getDividendHistory ? counted(provider.getDividendHistory(symbol, exchange)) : Promise.resolve([]);
}

export function getPriceHistory(symbol: string, exchange: string, fromDays: number) {
  const provider = getProvider();
  return provider.getPriceHistory
    ? counted(provider.getPriceHistory(symbol, exchange, fromDays))
    : Promise.resolve([]);
}

export function getProfile(symbol: string, exchange: string) {
  const provider = getProvider();
  return provider.getProfile ? counted(provider.getProfile(symbol, exchange)) : Promise.resolve(null);
}

export function getFundBreakdown(symbol: string, exchange: string) {
  const provider = getProvider();
  return provider.getFundBreakdown ? counted(provider.getFundBreakdown(symbol, exchange)) : Promise.resolve(null);
}

// Reserved for the O2 alerts/EODHD-degradation path (docs/SPEC_options-selling.md) — no callers yet.
export function providerSupportsOptions(): boolean {
  return getProvider().capabilities.options === true;
}

export function getOptionChain(underlying: string, exchange: string, expiration?: string) {
  const provider = getProvider();
  return provider.getOptionChain
    ? counted(provider.getOptionChain(underlying, exchange, expiration))
    : Promise.resolve(null);
}

// Reserved for O2 single-contract alerts (docs/SPEC_options-selling.md) — no callers yet; live
// option pricing goes through getOptionChain.
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
