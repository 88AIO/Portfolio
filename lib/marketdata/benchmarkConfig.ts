// The S&P 500 benchmark instrument. Kept apart from benchmark.ts (which syncs it) so pages that only
// need to find SPY don't import the market-data provider code.
export const BENCHMARK = { symbol: "SPY", exchange: "US", currency: "USD", name: "SPDR S&P 500 ETF Trust", type: "etf" } as const;
