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
// Currency can be a bare code or an object { code } / { currency }. Always upper-cased: the FX
// cache is keyed by uppercase code, so a lowercase "usd" would miss it and the holding would be
// converted at 1.0 — silently reporting a native figure as if it were the base currency.
function currencyOf(v: unknown): string {
  if (typeof v === "string" && v) return v.toUpperCase();
  if (v && typeof v === "object") {
    const o = v as { code?: unknown; currency?: unknown };
    const c = str(o.code) || str(o.currency);
    if (c) return c.toUpperCase();
  }
  return "USD";
}

// SnapTrade dates arrive as ISO dates or full timestamps. Anything else (a locale format like
// 06/19/2026) would be sliced to ten meaningless characters and stored verbatim as a date no
// downstream code can read, so treat it as absent and drop the row instead.
function isoDate(v: unknown): string {
  const s = str(v).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : "";
}

// The ticker root of an OCC contract code. Brokers send these both spaced ("AAPL  260619P00150000")
// and unspaced ("AAPL260619P00150000"); splitting on whitespace alone leaves the entire contract
// code as the "underlying", which would create and then perpetually quote a junk instrument.
// Splitting on the first digit handles both, and US option roots are alphabetic.
function rootSymbol(v: unknown): string {
  return str(v).trim().split(/[\s\d]/)[0] ?? "";
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
  const expiration = isoDate(o.expiration_date);
  if (strike == null || !expiration) return null;

  // Underlying ticker: prefer the nested underlying_symbol, fall back to the option ticker's root.
  const und = o.underlying_symbol as Record<string, unknown> | undefined;
  const underlying = (str(und?.symbol) || str(und?.raw_symbol) || rootSymbol(o.ticker)).toUpperCase();
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
  const tradeDate = isoDate(a.trade_date) || isoDate(a.settlement_date);
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

// --- Option POSITIONS (from the working getAllAccountPositions feed) ---
// SnapTrade's transactions feed is empty for many connections, but current OPEN option positions
// ride along in the positions response as an AccountPosition whose instrument.kind === "option".
// This turns one such position into an open seller leg. We import SHORT positions only (units < 0)
// — a sold put/call is the wheel story; a long option isn't seller income. See
// docs/SPEC_broker-sync-etrade-options.md.

// True when a positions-feed row is an option contract.
export function isOptionPosition(raw: unknown): boolean {
  if (!raw || typeof raw !== "object") return false;
  const inst = (raw as { instrument?: unknown }).instrument;
  if (!inst || typeof inst !== "object") return false;
  const i = inst as Record<string, unknown>;
  return str(i.kind).toLowerCase() === "option" || (i.strike_price != null && i.expiration_date != null && i.option_type != null);
}

/**
 * Normalize one option position (AccountPosition with an option instrument) into an open
 * `sell_to_open` leg, or null if it isn't a short option we track.
 * @param today YYYY-MM-DD — used as the leg's trade date (a snapshot has no open date).
 */
export function normalizeSnaptradeOptionPosition(raw: unknown, today: string): BrokerOptionLeg | null {
  if (!isOptionPosition(raw)) return null;
  const p = raw as Record<string, unknown>;
  const inst = p.instrument as Record<string, unknown>;

  const units = numOf(p.units);
  if (units == null || units >= 0) return null; // short only (negative units); skip long / flat
  const contracts = Math.abs(Math.round(units)) || 1;

  const rawOptType = str(inst.option_type).toUpperCase();
  const optionType: "put" | "call" | null = rawOptType.startsWith("P") ? "put" : rawOptType.startsWith("C") ? "call" : null;
  if (!optionType) return null;

  const strike = numOf(inst.strike_price);
  const expiration = isoDate(inst.expiration_date);
  if (strike == null || !expiration) return null;

  // Underlying ticker: the instrument's underlying object, else the OCC symbol's leading root.
  const und = inst.underlying as Record<string, unknown> | undefined;
  const underlying = (
    str(und?.symbol) || str(und?.raw_symbol) || str(und?.ticker) || rootSymbol(inst.symbol)
  ).toUpperCase();
  if (!underlying) return null;

  // Premium per share: SnapTrade cost_basis is the per-share average (same convention the equity
  // sync relies on); fall back to the market price. Stored positive — the DB view signs by action.
  const premiumPerShare = Math.abs(numOf(p.cost_basis) ?? numOf(p.price) ?? 0);

  return {
    underlying,
    exchange: "US",
    optionType,
    strike,
    expiration,
    action: "sell_to_open",
    contracts,
    premiumPerShare,
    fee: 0,
    currency: currencyOf(p.currency),
    tradeDate: today,
    // One open short position per contract → stable key for snapshot upsert.
    ref: `pos:${underlying}:${optionType}:${strike}:${expiration}`,
  };
}
