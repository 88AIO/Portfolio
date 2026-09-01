// Dividends and their reinvestments, as a broker reports them.
//
// E*TRADE files both under the same DIVIDEND activity type: the payment as a positive amount, and
// the reinvestment that spends it as a NEGATIVE amount carrying the units bought. Reading the
// second as income counted every reinvested dividend twice and lost the shares it bought.
import "./_resolve.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";

const { normalizeEquityActivity: normalizeSnaptradeEquityActivity } = await import("../lib/brokersync/providers/snaptrade.ts");

const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-6, `${msg}: got ${a}, want ${b}`);

const activity = (o) => ({
  id: "act-1", type: "DIVIDEND", trade_date: "2026-06-26T00:00:00Z",
  symbol: { symbol: "NVDA", exchange: { code: "NASDAQ" } }, currency: "USD", ...o,
});

test("a cash dividend is income", () => {
  const tx = normalizeSnaptradeEquityActivity(activity({ amount: 100.45 }));
  assert.equal(tx.txnType, "dividend");
  near(tx.quantity * tx.price, 100.45, "the whole payment");
  assert.ok(!tx.drip);
});

test("its reinvestment is a purchase, not a second dividend", () => {
  // The exact row from a real statement: DIVIDEND REINVESTMENT, -100.38, 0.515 shares at 194.923.
  const tx = normalizeSnaptradeEquityActivity(
    activity({ id: "act-2", amount: -100.38, units: 0.515, price: 194.923 })
  );
  assert.equal(tx.txnType, "buy", "a buy, not income");
  near(tx.quantity, 0.515, "the shares it bought");
  near(tx.price, 194.923, "at the price paid");
  assert.equal(tx.drip, true, "and marked as reinvested");
});

test("the pair nets to one dividend and one purchase", () => {
  // What the bug produced instead: $200.83 of income from a $100.45 payment.
  const paid = normalizeSnaptradeEquityActivity(activity({ amount: 100.45 }));
  const reinvested = normalizeSnaptradeEquityActivity(
    activity({ id: "act-2", amount: -100.38, units: 0.515, price: 194.923 })
  );
  const income = [paid, reinvested]
    .filter((t) => t.txnType === "dividend")
    .reduce((s, t) => s + t.quantity * t.price, 0);
  near(income, 100.45, "counted once");
});

test("a reversal keeps its sign instead of becoming income", () => {
  // A negative amount with no shares is a clawback. Math.abs() booked it as extra income.
  const tx = normalizeSnaptradeEquityActivity(activity({ id: "act-3", amount: -4.02 }));
  assert.equal(tx.txnType, "dividend");
  near(tx.quantity * tx.price, -4.02, "still a subtraction");
});

test("a zero-amount row is skipped", () => {
  assert.equal(normalizeSnaptradeEquityActivity(activity({ amount: 0 })), null);
});

test("a negative amount with units but no price is not treated as a purchase", () => {
  // Without a price there is nothing to record a buy at; better to leave it as the cash movement
  // than to invent a cost basis.
  const tx = normalizeSnaptradeEquityActivity(
    activity({ id: "act-4", amount: -50, units: 0.25, price: 0 })
  );
  assert.equal(tx.txnType, "dividend");
});
