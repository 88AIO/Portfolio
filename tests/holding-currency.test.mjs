// A holding page's figures are shown in the instrument's currency, but its transactions need not be
// recorded in that currency. These pin the two rules that keeps honest.
import "./_resolve.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";

const { computeRealizedLots, summarizeRealized } = await import("../lib/tax/realized.ts");

const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg}: got ${a}, want ${b}`);

test("a foreign-currency trade is never matched against a home-currency one", () => {
  // The guard computeRealizedLots was built with: grouping includes currency, so a GBP buy cannot
  // become the cost basis for a USD sale. The holding page used to override every row's currency to
  // the instrument's, which quietly switched that guard off on the one page that lists the lots.
  const lots = computeRealizedLots([
    { instrument_id: "i1", symbol: "AAA", exchange: "LSE", currency: "GBP", type: "buy",
      quantity: 10, price: 25, fees: 0, executed_at: "2024-01-02" },
    { instrument_id: "i1", symbol: "AAA", exchange: "US", currency: "USD", type: "sell",
      quantity: 10, price: 40, fees: 0, executed_at: "2025-01-02" },
  ]);
  // The USD sale finds no USD lot, so it realizes with zero basis rather than borrowing the GBP one.
  const usd = lots.filter((l) => l.currency === "USD");
  assert.equal(usd.length, 1);
  near(usd[0].costBasis, 0, "no cross-currency basis");
});

test("realized totals convert each lot at its own currency's rate", () => {
  const lots = computeRealizedLots([
    { instrument_id: "i1", symbol: "AAA", exchange: "LSE", currency: "GBP", type: "buy",
      quantity: 10, price: 10, fees: 0, executed_at: "2024-01-02" },
    { instrument_id: "i1", symbol: "AAA", exchange: "LSE", currency: "GBP", type: "sell",
      quantity: 10, price: 15, fees: 0, executed_at: "2025-01-02" },
  ]);
  // £50 of gain reported in a USD-based view at 1.25 is $62.50, not $50.
  const summary = summarizeRealized(lots, (c) => (c === "GBP" ? 1.25 : 1));
  near(summary.shortTermGain + summary.longTermGain, 62.5, "converted, not summed raw");
});
