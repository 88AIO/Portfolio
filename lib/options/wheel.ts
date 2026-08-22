// Wheel-cycle view: rolls each underlying's option premium, dividends, and realized stock P/L
// into one "wheel" story with its current phase and a blended annualized return. This is the
// O2 "the wheel as one story" piece — track & inform, never advise.
import type { ComputedOption } from "@/lib/options";

export type WheelPosition = {
  symbol: string;
  currency: string;
  shares: number;
  avg_cost: number;
  last_price: number | null;
  div_paid: number | null;
};

export type WheelPhase = "selling_puts" | "covered_call" | "holding" | "idle";

export type WheelRow = {
  symbol: string;
  currency: string;
  phase: WheelPhase;
  premium: number; // net option premium collected on this name (base currency)
  dividends: number; // dividends received while in the wheel (base currency)
  realizedStock: number; // realized stock P/L from assigned → called-away shares (base currency)
  unrealizedStock: number; // if still holding, mark-to-market P/L (base currency)
  totalProfit: number; // premium + dividends + realizedStock
  shares: number;
  openPuts: number; // open short put contracts
  openCalls: number; // open short call contracts
  capital: number; // representative capital at risk (base currency)
  daysActive: number;
  annualizedReturn: number | null; // totalProfit / capital, annualized, as a percent
};

// One dated entry in a ticker's full wheel history — an option leg, a share assignment/trade,
// or a dividend. Amounts are in that event's native currency (signed: + cash in, − cash out).
export type WheelEvent = {
  date: string; // YYYY-MM-DD
  kind: "option" | "buy" | "sell" | "dividend";
  title: string;
  detail: string;
  amount: number | null;
  currency: string;
};

const PHASE_LABEL: Record<WheelPhase, string> = {
  selling_puts: "Selling puts",
  covered_call: "Covered call",
  holding: "Holding shares",
  idle: "Between cycles",
};
export function wheelPhaseLabel(p: WheelPhase): string {
  return PHASE_LABEL[p];
}

/**
 * Build one wheel row per underlying that has had option activity.
 * @param options       computed option positions (all legs)
 * @param positions     current equity positions keyed by symbol (shares, avg cost, price, divs)
 * @param realizedBySymbol realized stock P/L per symbol, already in base currency
 * @param fx            currency → base multiplier
 * @param today         YYYY-MM-DD
 */
export function computeWheels(
  options: ComputedOption[],
  positions: Map<string, WheelPosition>,
  realizedBySymbol: Map<string, number>,
  fx: (ccy: string) => number,
  today: string
): WheelRow[] {
  // Group option legs by underlying symbol.
  const bySymbol = new Map<string, ComputedOption[]>();
  for (const o of options) {
    const arr = bySymbol.get(o.symbol);
    if (arr) arr.push(o);
    else bySymbol.set(o.symbol, [o]);
  }

  const todayMs = new Date(`${today}T00:00:00Z`).getTime();
  const rows: WheelRow[] = [];

  for (const [symbol, legs] of bySymbol) {
    const pos = positions.get(symbol);
    const currency = legs[0].currency;
    const r = fx(currency);

    const premium = legs.reduce((s, o) => s + o.premiumCollected * r, 0);
    let openPuts = 0, openCalls = 0, openPutCollateral = 0;
    let earliest = today;
    for (const o of legs) {
      if (o.opened_at && o.opened_at < earliest) earliest = o.opened_at;
      if (o.isOpen && o.option_type === "put") { openPuts += o.contracts; openPutCollateral += o.collateral * r; }
      if (o.isOpen && o.option_type === "call") openCalls += o.contracts;
    }

    const shares = pos?.shares ?? 0;
    const avgCost = pos?.avg_cost ?? 0;
    const lastPrice = pos?.last_price ?? null;
    const dividends = (pos?.div_paid ?? 0) * r;
    const realizedStock = realizedBySymbol.get(symbol) ?? 0;
    const unrealizedStock = shares > 0 && lastPrice != null ? (lastPrice - avgCost) * shares * r : 0;

    const totalProfit = premium + dividends + realizedStock;

    // Phase from the current state.
    let phase: WheelPhase;
    if (shares > 0 && openCalls > 0) phase = "covered_call";
    else if (shares > 0) phase = "holding";
    else if (openPuts > 0) phase = "selling_puts";
    else phase = "idle";

    // Capital at risk: shares tie up their cost; short puts tie up their collateral.
    const capital = Math.max(shares > 0 ? avgCost * shares * r : 0, openPutCollateral);
    const daysActive = Math.max(1, Math.round((todayMs - new Date(`${earliest}T00:00:00Z`).getTime()) / 86_400_000));
    const annualizedReturn = capital > 0 ? (totalProfit / capital) * (365 / daysActive) * 100 : null;

    rows.push({
      symbol, currency, phase, premium, dividends, realizedStock, unrealizedStock, totalProfit,
      shares, openPuts, openCalls, capital, daysActive, annualizedReturn,
    });
  }

  return rows.sort((a, b) => b.totalProfit - a.totalProfit);
}
