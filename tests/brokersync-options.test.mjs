// Broker option normalization — the last code that WRITES to the ledger rather than displaying it.
// These two functions produced the option legs currently in the database, from a feed that
// SnapTrade types as `[key: string]: any`. A parsing slip here doesn't show a wrong number, it
// stores one permanently.
import "./_resolve.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";

const { normalizeSnaptradeActivity, normalizeSnaptradeOptionPosition, isOptionPosition } =
  await import("../lib/brokersync/options.ts");

const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg}: got ${a}, want ${b}`);

/** A SELL_TO_OPEN put on AAPL: 2 contracts at $2.50/share, $1.30 fee. */
const activity = (o = {}, opt = {}) => ({
  id: "act-1",
  type: "TRADE",
  option_type: "SELL_TO_OPEN",
  units: -2,
  price: 2.5,
  amount: 500,
  fee: 1.3,
  currency: { code: "USD" },
  trade_date: "2026-05-04T13:30:00Z",
  option_symbol: {
    option_type: "PUT",
    strike_price: 150,
    expiration_date: "2026-06-19",
    ticker: "AAPL  260619P00150000",
    underlying_symbol: { symbol: "AAPL" },
    ...opt,
  },
  ...o,
});

// --- Activity feed -------------------------------------------------------------------------------

test("a sold-to-open put becomes a seller leg with positive magnitudes", () => {
  const leg = normalizeSnaptradeActivity(activity());
  assert.equal(leg.action, "sell_to_open");
  assert.equal(leg.underlying, "AAPL");
  assert.equal(leg.optionType, "put");
  near(leg.strike, 150, "strike");
  assert.equal(leg.expiration, "2026-06-19");
  assert.equal(leg.contracts, 2, "units are a magnitude, sign carried by the action");
  near(leg.premiumPerShare, 2.5, "premium");
  near(leg.fee, 1.3, "fee is a positive cost");
  assert.equal(leg.tradeDate, "2026-05-04", "timestamp trimmed to a calendar date");
  assert.equal(leg.ref, "act-1");
});

test("each seller-flow event maps to its action", () => {
  assert.equal(normalizeSnaptradeActivity(activity({ option_type: "BUY_TO_CLOSE" })).action, "buy_to_close");
  assert.equal(normalizeSnaptradeActivity(activity({ type: "OPTIONEXPIRATION" })).action, "expired");
  assert.equal(normalizeSnaptradeActivity(activity({ type: "OPTION_ASSIGNMENT" })).action, "assigned");
});

test("long-option activity is skipped — this is a sellers' tracker", () => {
  for (const t of ["BUY_TO_OPEN", "SELL_TO_CLOSE", "OPTIONEXERCISE", ""]) {
    assert.equal(normalizeSnaptradeActivity(activity({ option_type: t })), null, t);
  }
});

test("non-option rows and junk are ignored rather than half-parsed", () => {
  assert.equal(normalizeSnaptradeActivity({ type: "TRADE", units: 1 }), null, "no option_symbol");
  assert.equal(normalizeSnaptradeActivity(null), null);
  assert.equal(normalizeSnaptradeActivity("nope"), null);
  assert.equal(normalizeSnaptradeActivity(activity({}, { option_type: "WARRANT" })), null, "not a put or call");
  assert.equal(normalizeSnaptradeActivity(activity({}, { strike_price: null })), null, "no strike");
  assert.equal(normalizeSnaptradeActivity(activity({ trade_date: "", settlement_date: "" })), null, "no date");
});

test("premium is backed out of the total when no per-share price is reported", () => {
  // $500 over 2 contracts x 100 shares = $2.50/share.
  const leg = normalizeSnaptradeActivity(activity({ price: null }));
  near(leg.premiumPerShare, 2.5, "derived from amount");
});

test("the underlying survives an OCC ticker with no space in it", () => {
  // Splitting only on whitespace leaves the whole contract code as the "ticker", which would
  // create an instrument row called AAPL260619P00150000 and quote it forever.
  const leg = normalizeSnaptradeActivity(
    activity({}, { underlying_symbol: undefined, ticker: "AAPL260619P00150000" })
  );
  assert.equal(leg.underlying, "AAPL");
});

test("a non-ISO expiration is rejected rather than stored as junk", () => {
  // slice(0,10) on "06/19/2026" yields "06/19/2026" — not a date any downstream code can read.
  assert.equal(normalizeSnaptradeActivity(activity({}, { expiration_date: "06/19/2026" })), null);
});

test("a non-ISO trade date is rejected rather than stored as junk", () => {
  assert.equal(normalizeSnaptradeActivity(activity({ trade_date: "05/04/2026", settlement_date: "" })), null);
});

test("currency is normalized to an uppercase code", () => {
  // A lowercase code misses the FX rate table (which is keyed uppercase) and silently converts
  // at 1.0 — a non-USD holding then reports its native figure as if it were base currency.
  assert.equal(normalizeSnaptradeActivity(activity({ currency: "usd" })).currency, "USD");
  assert.equal(normalizeSnaptradeActivity(activity({ currency: { code: "eur" } })).currency, "EUR");
  assert.equal(normalizeSnaptradeActivity(activity({ currency: null })).currency, "USD", "defaults");
});

test("without a broker id, the ref is a stable composite of the trade's identity", () => {
  const a = normalizeSnaptradeActivity(activity({ id: "", external_reference_id: "" }));
  const b = normalizeSnaptradeActivity(activity({ id: "", external_reference_id: "" }));
  assert.equal(a.ref, b.ref, "re-syncing the same activity must dedupe");
  assert.match(a.ref, /AAPL/);
});

// --- Positions feed ------------------------------------------------------------------------------

const position = (o = {}, inst = {}) => ({
  units: -3,
  cost_basis: 1.75,
  price: 0.9,
  currency: { code: "USD" },
  instrument: {
    kind: "option",
    option_type: "CALL",
    strike_price: 200,
    expiration_date: "2026-09-18",
    symbol: "MSFT  260918C00200000",
    underlying: { symbol: "MSFT" },
    ...inst,
  },
  ...o,
});

test("isOptionPosition recognises option rows by kind or by shape", () => {
  assert.ok(isOptionPosition(position()));
  assert.ok(isOptionPosition(position({}, { kind: "" })), "falls back to strike/expiry/type");
  assert.ok(!isOptionPosition({ instrument: { kind: "equity", symbol: "MSFT" } }));
  assert.ok(!isOptionPosition(null));
});

test("a SHORT option position becomes an open sell_to_open leg", () => {
  const leg = normalizeSnaptradeOptionPosition(position(), "2026-08-30");
  assert.equal(leg.action, "sell_to_open");
  assert.equal(leg.underlying, "MSFT");
  assert.equal(leg.optionType, "call");
  assert.equal(leg.contracts, 3, "magnitude of the negative units");
  near(leg.premiumPerShare, 1.75, "cost_basis is the per-share average");
  assert.equal(leg.tradeDate, "2026-08-30", "a snapshot has no open date");
  assert.equal(leg.fee, 0);
  assert.equal(leg.ref, "pos:MSFT:call:200:2026-09-18", "stable across snapshots");
});

test("long and flat positions are skipped — a bought option is not seller income", () => {
  assert.equal(normalizeSnaptradeOptionPosition(position({ units: 3 }), "2026-08-30"), null);
  assert.equal(normalizeSnaptradeOptionPosition(position({ units: 0 }), "2026-08-30"), null);
  assert.equal(normalizeSnaptradeOptionPosition(position({ units: null }), "2026-08-30"), null);
});

test("the position's underlying survives an OCC symbol with no space", () => {
  const leg = normalizeSnaptradeOptionPosition(
    position({}, { underlying: undefined, symbol: "MSFT260918C00200000" }),
    "2026-08-30"
  );
  assert.equal(leg.underlying, "MSFT");
});

test("premium falls back to market price when cost basis is missing", () => {
  const leg = normalizeSnaptradeOptionPosition(position({ cost_basis: null }), "2026-08-30");
  near(leg.premiumPerShare, 0.9, "uses price");
});

test("a position with a non-ISO expiration is rejected", () => {
  assert.equal(normalizeSnaptradeOptionPosition(position({}, { expiration_date: "09/18/2026" }), "2026-08-30"), null);
});

test("position currency is normalized to uppercase too", () => {
  assert.equal(normalizeSnaptradeOptionPosition(position({ currency: "eur" }), "2026-08-30").currency, "EUR");
});
