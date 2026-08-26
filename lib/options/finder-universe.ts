// The seed universe the O3 put finder scans alongside the user's own US holdings — a small,
// liquid, optionable set kept bounded to stay inside free-tier data limits (cost model:
// docs/EFFICIENCY_AUDIT.md).
// Shared so the nightly cron captures IV samples for exactly these names too.
export const FINDER_UNIVERSE = [
  "AAPL", "MSFT", "NVDA", "AMD", "KO", "PEP", "JPM", "XOM",
  "O", "SCHD", "QQQ", "SPY", "T", "VZ", "PFE",
];

// Cap on the combined (held + seed) scan universe per request.
export const FINDER_MAX_UNIVERSE = 14;
