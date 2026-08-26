// Options-selling cockpit math (O1). Turns raw `option_positions` view rows into the
// derived fields the UI shows — collateral, annualized return-on-capital, covered/naked,
// distance-to-strike, status — and rolls them into the four cockpit totals.
// Track & inform only: nothing here recommends an action. See docs/SPEC_options-selling.md.

// One raw row from the `option_positions` DB view.
export type OptionPositionRow = {
  portfolio_id: string;
  instrument_id: string;
  symbol: string;
  exchange: string;
  name: string | null;
  option_type: "put" | "call";
  strike: number;
  expiration: string; // YYYY-MM-DD
  currency: string;
  net_contracts: number; // Σ sell_to_open − closes/expiries/assignments
  sold_contracts: number;
  premium_net: number; // net dollars kept (per-share × 100 × contracts − fees), signed
  opened_at: string;
  last_action_at: string;
  underlying_price: number | null;
  underlying_shares: number;
  dte: number; // expiration − today, in days (can be negative if past)
};

export type OptionStatus =
  | "on_track"
  | "may_be_assigned"
  | "expired"
  | "closed";

export type ComputedOption = OptionPositionRow & {
  isOpen: boolean;
  contracts: number; // open contracts (abs of net when open)
  premiumCollected: number; // = premium_net
  collateral: number; // put: strike×100×contracts; covered call: mktval of covered shares
  covered: boolean; // a short call fully covered by held shares
  naked: boolean; // a short call NOT covered (allowed, flagged)
  cashSecured: boolean; // a short put (secured by collateral)
  inTheMoney: boolean;
  distanceToStrikePct: number | null; // (underlyingPrice − strike)/underlyingPrice × 100
  annualizedRoC: number | null; // premium / collateral × 365 / max(dte,1), as a percent
  status: OptionStatus;
};

const MS = 1;

export function computeOption(row: OptionPositionRow): ComputedOption {
  const isOpen = row.net_contracts > 0;
  const contracts = Math.max(row.net_contracts, 0);
  const shares100 = contracts * 100;
  const px = row.underlying_price;

  const collateral =
    row.option_type === "put"
      ? row.strike * shares100
      : (px ?? row.strike) * shares100; // covered call collateral ≈ market value of covered shares

  const covered = row.option_type === "call" && row.underlying_shares >= shares100 && contracts > 0;
  const naked = row.option_type === "call" && !covered && isOpen;
  const cashSecured = row.option_type === "put" && isOpen;

  const inTheMoney =
    px == null
      ? false
      : row.option_type === "put"
        ? px < row.strike
        : px > row.strike;

  const distanceToStrikePct =
    px && px > 0 ? ((px - row.strike) / px) * 100 : null;

  const annualizedRoC =
    // Only annualize a position that still has time left. A stale ledger leg past its expiration
    // (isOpen but dte <= 0) would otherwise divide 365 by a floor and print an absurd RoC (e.g. 365×).
    isOpen && row.dte > 0 && collateral > 0 && row.premium_net > 0
      ? (row.premium_net / collateral) * (365 / Math.max(row.dte, MS)) * 100 // as a percent
      : null;

  let status: OptionStatus;
  if (!isOpen) status = "closed";
  else if (row.dte < 0) status = "expired";
  else if (inTheMoney && row.dte <= 5) status = "may_be_assigned";
  else status = "on_track";

  return {
    ...row,
    isOpen,
    contracts,
    premiumCollected: row.premium_net,
    collateral,
    covered,
    naked,
    cashSecured,
    inTheMoney,
    distanceToStrikePct,
    annualizedRoC,
    status,
  };
}

export type OptionTotals = {
  premiumIncome: number; // net premium kept across ALL option legs
  openPremium: number; // premium on still-open positions
  avgAnnualizedRoC: number | null; // collateral-weighted average across open positions
  openCount: number;
  expiringCount: number; // open positions expiring within 7 days
  expiringPremium: number;
  nakedCount: number;
  totalCollateral: number; // capital tied up by open positions
};

// Roll computed positions into the cockpit's headline numbers.
// `fx(ccy)` converts a position's currency into the base currency.
export function computeOptionTotals(
  positions: ComputedOption[],
  fx: (ccy: string) => number = () => 1
): OptionTotals {
  let premiumIncome = 0;
  let openPremium = 0;
  let expiringCount = 0;
  let expiringPremium = 0;
  let nakedCount = 0;
  let totalCollateral = 0;
  let rocWeightSum = 0;
  let rocWeightedTotal = 0;
  let openCount = 0;

  for (const p of positions) {
    const r = fx(p.currency);
    premiumIncome += p.premiumCollected * r;
    if (p.isOpen) {
      openCount += 1;
      openPremium += p.premiumCollected * r;
      totalCollateral += p.collateral * r;
      if (p.naked) nakedCount += 1;
      if (p.dte >= 0 && p.dte <= 7) {
        expiringCount += 1;
        expiringPremium += p.premiumCollected * r;
      }
      if (p.annualizedRoC != null && p.collateral > 0) {
        const w = p.collateral * r;
        rocWeightSum += w;
        rocWeightedTotal += p.annualizedRoC * w;
      }
    }
  }

  return {
    premiumIncome,
    openPremium,
    avgAnnualizedRoC: rocWeightSum > 0 ? rocWeightedTotal / rocWeightSum : null,
    openCount,
    expiringCount,
    expiringPremium,
    nakedCount,
    totalCollateral,
  };
}

// --- O2: alerts + wheel/income-by-underlying ---

export type AttentionItem = {
  kind: "assignment" | "expiry" | "ex_dividend";
  symbol: string;
  detail: string;
  date: string; // YYYY-MM-DD the event happens
  severity: "warn" | "info";
};

// A single-name "wheel" story: all option premium + dividends earned on one underlying,
// plus its current state (shares held, open short puts/calls). Amounts already in base ccy.
export type UnderlyingIncome = {
  symbol: string;
  premium: number;
  dividends: number;
  total: number;
  shares: number;
  openPuts: number; // open short put contracts
  openCalls: number; // open short call contracts
};

// --- O3: cash-secured put finder ---
export type FinderRow = {
  symbol: string;
  price: number;
  strike: number;
  expiration: string;
  dte: number;
  premium: number; // per share (option mark)
  annualizedRoC: number; // percent
  iv: number | null; // current implied volatility, percent
  ivRank: number | null; // where current IV sits in its trailing range, 0..100 (null while building)
  ivBuilding: boolean; // true when we don't yet have enough IV history to rank honestly
  divYield: number | null; // trailing dividend yield, percent
  safetyScore: number | null; // dividend-safety score 0..100 (null when history too thin)
  safetyBand: string; // "very-safe" | "safe" | "watch" | "at-risk" | "unrated"
  safetyLabel: string; // human label for the band
  held: boolean; // already in the user's holdings
};

export type FinderResult = {
  rows: FinderRow[];
  scanned: number;
  truncated: boolean;
  targetDte: number;
  otmPct: number;
};

export function statusLabel(s: OptionStatus): string {
  switch (s) {
    case "may_be_assigned":
      return "May be assigned";
    case "expired":
      return "Expired";
    case "closed":
      return "Closed";
    default:
      return "On track";
  }
}

export function optionActionLabel(action: string): string {
  switch (action) {
    case "sell_to_open":
      return "Sold to open";
    case "buy_to_close":
      return "Bought to close";
    case "expired":
      return "Expired";
    case "assigned":
      return "Assigned";
    case "rolled":
      return "Rolled";
    default:
      return action;
  }
}
