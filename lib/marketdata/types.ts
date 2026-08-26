// Market-data provider port — shared types.
// Every data vendor (Yahoo, EODHD, …) implements MarketDataProvider so the rest of the
// app depends on this interface, never on a specific vendor.

export type Quote = {
  price: number | null;
  currency: string | null;
  changePct: number | null;
};

export type InstrumentMeta = {
  name: string;
  currency: string;
  type: string; // stock | etf | fund | bond | crypto | cash | index | custom
};

export type DividendInfo = {
  annualDividendPerShare: number | null;
  yieldTtm: number | null; // trailing dividend yield, as a percent
  exDividendDate: string | null; // YYYY-MM-DD
  nextDividendDate: string | null; // YYYY-MM-DD (next pay date)
};

export type DividendHistoryPoint = {
  exDate: string; // YYYY-MM-DD
  amount: number; // per share, in the instrument's currency
};

// A historical closing price used to draw portfolio value over time.
export type PriceHistoryPoint = {
  date: string; // YYYY-MM-DD
  close: number; // in the instrument's currency
};

export type InstrumentProfile = {
  sector: string | null;
  country: string | null; // e.g. "United States"
};

// ETF/fund look-through: the fund's exposure across sectors (weights sum to ~1).
// Sector labels match the single-sector strings used for individual stocks.
export type FundBreakdown = {
  sectorWeights: { sector: string; weight: number }[];
};

// --- Options (used by the NEXT+ options-selling layer; see docs/SPEC_options-selling.md) ---
export type OptionQuote = {
  mark: number | null;
  bid: number | null;
  ask: number | null;
  iv: number | null;
  openInterest: number | null;
};

export type OptionContract = {
  type: "put" | "call";
  strike: number;
  expiration: string; // ISO date (YYYY-MM-DD)
  mark: number | null;
  bid: number | null;
  ask: number | null;
  iv: number | null;
  openInterest: number | null;
};

export type OptionChain = {
  underlying: string;
  expiration: string | null;
  expirations: string[];
  contracts: OptionContract[];
};

export type ProviderCapabilities = {
  options: boolean;
};

export interface MarketDataProvider {
  readonly name: string;
  readonly capabilities: ProviderCapabilities;

  getQuote(symbol: string, exchange: string): Promise<Quote>;
  getFxRate(from: string, base: string): Promise<number>;
  searchInstrument(symbol: string, exchange: string): Promise<InstrumentMeta | null>;
  getDividendInfo?(symbol: string, exchange: string): Promise<DividendInfo | null>;
  getDividendHistory?(symbol: string, exchange: string): Promise<DividendHistoryPoint[]>;
  getPriceHistory?(symbol: string, exchange: string, fromDays: number): Promise<PriceHistoryPoint[]>;
  getProfile?(symbol: string, exchange: string): Promise<InstrumentProfile | null>;
  getFundBreakdown?(symbol: string, exchange: string): Promise<FundBreakdown | null>;

  // Optional — only providers with capabilities.options implement these (wired up in the O1 phase).
  getOptionQuote?(
    underlying: string,
    exchange: string,
    type: "put" | "call",
    strike: number,
    expiration: string
  ): Promise<OptionQuote>;
  getOptionChain?(underlying: string, exchange: string, expiration?: string): Promise<OptionChain>;
}
