// Broker option-activity normalization. SnapTrade's account-activities feed (getAccountActivities →
// UniversalActivity) reports every option event a brokerage like E*TRADE records: sold/bought legs,
// expirations, and assignments. This turns one raw activity row into the seller-focused shape our
// `option_transactions` ledger stores — or null when it isn't an option event we track.
//
// We only import the FOUR seller-flow events (see docs/SPEC_broker-sync-etrade-options.md):
//   SELL_TO_OPEN → sell_to_open · BUY_TO_CLOSE → buy_to_close · OPTIONEXPIRATION → expired ·
//   OPTIONASSIGNMENT → assigned.
// Long-option activity (BUY_TO_OPEN / SELL_TO_CLOSE / OPTIONEXERCISE) is skipped — Snowfolio is an
// options-SELLING tracker, and premium math in the DB views assumes the seller's side.

export type BrokerOptionAction = "sell_to_open" | "buy_to_close" | "expired" | "assigned";

// One normalized option leg, ready to insert into `option_transactions`. `premiumPerShare` and
// `fee` are POSITIVE magnitudes — the DB view signs them by action (credit on open, debit on close).
export type BrokerOptionLeg = {
  underlying: string;
  exchange: string; // normalized code; US for E*TRADE options
  optionType: "put" | "call";
  strike: number;
  expiration: string; // YYYY-MM-DD
  action: BrokerOptionAction;
  contracts: number;
  premiumPerShare: number;
  fee: number;
  currency: string;
  tradeDate: string; // YYYY-MM-DD
  ref: string; // stable brokerage/SnapTrade id, for idempotent dedupe
};

function str(v: unknown): string {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}
function numOf(v: unknown): number | null {
  if (typeof v === "number") return isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "" && isFinite(Number(v))) return Number(v);
  return null;
}
// Currency can be a bare code or an object { code } / { currency }.
function currencyOf(v: unknown): string {
  if (typeof v === "string" && v) return v;
  if (v && typeof v === "object") {
    const o = v as { code?: unknown; currency?: unknown };
    const c = str(o.code) || str(o.currency);
    if (c) return c;
  }
  return "USD";
}

// Map a SnapTrade activity (`type`, `option_type`) onto our seller-flow action, or null to skip.
function toAction(type: string, optionType: string): BrokerOptionAction | null {
  const t = type.toUpperCase().replace(/[\s_]/g, "");
  if (t === "OPTIONEXPIRATION" || t === "EXPIRATION") return "expired";
  if (t === "OPTIONASSIGNMENT" || t === "ASSIGNMENT") return "assigned";
  const ot = optionType.toUpperCase().replace(/[\s-]/g, "_");
  if (ot === "SELL_TO_OPEN") return "sell_to_open";
  if (ot === "BUY_TO_CLOSE") return "buy_to_close";
  return null; // BUY_TO_OPEN / SELL_TO_CLOSE / OPTIONEXERCISE / plain buy-sell → not seller flow
}

/**
 * Normalize one SnapTrade UniversalActivity into a seller-flow option leg, or null if it isn't an
 * option event we track. Defensive against SnapTrade's loosely-typed `[key: string]: any` shapes.
 */
export function normalizeSnaptradeActivity(raw: unknown): BrokerOptionLeg | null {
  if (!raw || typeof raw !== "object") return null;
  const a = raw as Record<string, unknown>;

  const opt = a.option_symbol;
  if (!opt || typeof opt !== "object") return null; // no contract info → not an option activity
  const o = opt as Record<string, unknown>;

  const action = toAction(str(a.type), str(a.option_type));
  if (!action) return null;

  const rawOptType = str(o.option_type).toUpperCase();
  const optionType: "put" | "call" | null = rawOptType.startsWith("P") ? "put" : rawOptType.startsWith("C") ? "call" : null;
  if (!optionType) return null;

  const strike = numOf(o.strike_price);
  const expiration = str(o.expiration_date).slice(0, 10);
  if (strike == null || !expiration) return null;

  // Underlying ticker: prefer the nested underlying_symbol, fall back to the option ticker's root.
  const und = o.underlying_symbol as Record<string, unknown> | undefined;
  const underlying = (str(und?.symbol) || str(und?.raw_symbol) || str(o.ticker).split(/[\s_]/)[0]).toUpperCase();
  if (!underlying) return null;

  const contracts = Math.abs(Math.round(numOf(a.units) ?? 0)) || 1;
  const price = numOf(a.price);
  const amount = numOf(a.amount);
  // Premium per share (positive). Prefer the reported per-share price; else back it out of the
  // total amount over the covered shares (contracts × 100).
  const premiumPerShare = price != null ? Math.abs(price)
    : amount != null ? Math.abs(amount) / (contracts * 100)
    : 0;
  const fee = Math.abs(numOf(a.fee) ?? 0);
  const tradeDate = (str(a.trade_date) || str(a.settlement_date)).slice(0, 10);
  if (!tradeDate) return null;

  const ref = str(a.id) || str(a.external_reference_id) ||
    `${underlying}:${optionType}:${strike}:${expiration}:${action}:${tradeDate}:${contracts}`;

  return {
    underlying,
    exchange: "US",
    optionType,
    strike,
    expiration,
    action,
    contracts,
    premiumPerShare,
    fee,
    currency: currencyOf(a.currency),
    tradeDate,
    ref,
  };
}
