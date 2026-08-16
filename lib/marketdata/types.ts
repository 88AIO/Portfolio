// Market-data provider port — shared types.
// Every data vendor (Yahoo, EODHD, …) implements MarketDataProvider so the rest of the
// app depends on this interface, never on a specific vendor. See docs/MARKET_DATA_ADAPTER.md.

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
