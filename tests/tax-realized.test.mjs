// FIFO realized-gains engine — the highest-stakes math in the app.
//
// These numbers go on a user's tax return. A wrong option-premium figure is annoying; a wrong
// realized gain is filed with the IRS. The engine had no tests at all before this file, so each
// case below pins a rule the engine is *claiming* to implement, not just its current output.
import "./_resolve.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";

const { computeRealizedLots, summarizeRealized, lotsInYear, realizedYears } = await import(
  "../lib/tax/realized.ts"
);

const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg}: got ${a}, want ${b}`);

function tx(o) {
  return { symbol: "AAA", currency: "USD", fees: 0, ...o };
}

test("a simple round trip: fees fold into basis on the buy and reduce proceeds on the sell", () => {
  const lots = computeRealizedLots([
    tx({ type: "buy", quantity: 10, price: 100, fees: 5, executed_at: "2024-01-10" }),
    tx({ type: "sell", quantity: 10, price: 120, fees: 7, executed_at: "2024-06-10" }),
  ]);
  assert.equal(lots.length, 1);
  near(lots[0].costBasis, 1005, "cost basis includes the buy fee");
  near(lots[0].proceeds, 1193, "proceeds are net of the sell fee");
  near(lots[0].gain, 188, "gain");
  assert.equal(lots[0].longTerm, false);
});

test("FIFO takes the OLDEST lot first, not the cheapest", () => {
  const lots = computeRealizedLots([
    tx({ type: "buy", quantity: 10, price: 100, executed_at: "2024-01-01" }),
    tx({ type: "buy", quantity: 10, price: 50, executed_at: "2024-02-01" }),
    tx({ type: "sell", quantity: 10, price: 120, executed_at: "2024-03-01" }),
  ]);
  assert.equal(lots.length, 1);
  near(lots[0].costBasis, 1000, "must consume the $100 lot, not the $50 one");
  assert.equal(lots[0].openDate, "2024-01-01");
});

test("one sell spanning two lots emits one row per lot, each with its own open date", () => {
  const lots = computeRealizedLots([
    tx({ type: "buy", quantity: 10, price: 100, executed_at: "2024-01-01" }),
    tx({ type: "buy", quantity: 10, price: 50, executed_at: "2024-02-01" }),
    tx({ type: "sell", quantity: 15, price: 120, executed_at: "2024-03-01" }),
  ]);
  assert.equal(lots.length, 2);
  near(lots[0].quantity, 10, "first slice drains the older lot");
  near(lots[1].quantity, 5, "second slice takes part of the newer lot");
  near(lots[0].costBasis + lots[1].costBasis, 1000 + 250, "total basis across both slices");
});

test("a same-day round trip matches: buys are processed before sells on the same date", () => {
  const lots = computeRealizedLots([
    tx({ type: "sell", quantity: 5, price: 110, executed_at: "2024-05-01" }),
    tx({ type: "buy", quantity: 5, price: 100, executed_at: "2024-05-01" }),
  ]);
  assert.equal(lots.length, 1);
  near(lots[0].costBasis, 500, "the same-day buy must be available to the sell");
  near(lots[0].gain, 50, "gain");
});

test("overselling with no open lot realizes the proceeds at zero basis rather than dropping them", () => {
  const lots = computeRealizedLots([
    tx({ type: "sell", quantity: 3, price: 90, executed_at: "2024-04-01" }),
  ]);
  assert.equal(lots.length, 1);
  near(lots[0].costBasis, 0, "no basis available");
  near(lots[0].gain, 270, "proceeds still surface");
});

// --- The long-term boundary ---------------------------------------------------------------------
// IRS Pub. 550: the holding period begins the day AFTER acquisition and includes the disposal day,
// and the gain is long-term only when held MORE than one year. So a sale on the one-year
// anniversary is still SHORT-term. Long-term rates are lower, so getting this wrong in the
// permissive direction understates the tax owed.

test("selling ON the one-year anniversary is SHORT-term", () => {
  const lots = computeRealizedLots([
    tx({ type: "buy", quantity: 1, price: 100, executed_at: "2023-01-01" }),
    tx({ type: "sell", quantity: 1, price: 200, executed_at: "2024-01-01" }),
  ]);
  assert.equal(lots[0].longTerm, false, "exactly one year is 'one year or less' — short-term");
});

test("selling the day AFTER the anniversary is long-term", () => {
  const lots = computeRealizedLots([
    tx({ type: "buy", quantity: 1, price: 100, executed_at: "2023-01-01" }),
    tx({ type: "sell", quantity: 1, price: 200, executed_at: "2024-01-02" }),
  ]);
  assert.equal(lots[0].longTerm, true);
});

test("the boundary holds across a leap year, where 365 days is not one calendar year", () => {
  // 2024 is a leap year: 2024-01-01 → 2025-01-01 spans 366 days. A day-count rule of >= 365 would
  // call 2024-12-31 (365 days) long-term, but it is one day short of a calendar year.
  const short = computeRealizedLots([
    tx({ type: "buy", quantity: 1, price: 100, executed_at: "2024-01-01" }),
    tx({ type: "sell", quantity: 1, price: 200, executed_at: "2024-12-31" }),
  ]);
  assert.equal(short[0].longTerm, false, "365 days inside a leap year is still under one year");

  const long = computeRealizedLots([
    tx({ type: "buy", quantity: 1, price: 100, executed_at: "2024-01-01" }),
    tx({ type: "sell", quantity: 1, price: 200, executed_at: "2025-01-02" }),
  ]);
  assert.equal(long[0].longTerm, true);
});

// --- Cross-listing safety ------------------------------------------------------------------------

test("the same ticker in two currencies must NOT be matched against itself", () => {
  // A dual-listed name (e.g. a London line in GBP and a US line in USD) shares a ticker string.
  // Matching a GBP buy against a USD sell produces a gain that is arithmetic nonsense, and the
  // tax page then multiplies it by the SELL currency's FX rate.
  const lots = computeRealizedLots([
    { symbol: "SHEL", currency: "GBP", type: "buy", quantity: 10, price: 25, fees: 0, executed_at: "2024-01-01" },
    { symbol: "SHEL", currency: "USD", type: "sell", quantity: 10, price: 70, fees: 0, executed_at: "2024-06-01" },
  ]);
  // The USD sell has no USD lot to match, so it realizes at zero basis; the GBP buy stays open.
  assert.equal(lots.length, 1, "one realized lot, from the unmatched USD sell");
  assert.equal(lots[0].currency, "USD");
  near(lots[0].costBasis, 0, "a GBP purchase is not cost basis for a USD sale");
});

test("same ticker, same currency still matches normally", () => {
  const lots = computeRealizedLots([
    tx({ type: "buy", quantity: 10, price: 100, executed_at: "2024-01-01" }),
    tx({ type: "sell", quantity: 10, price: 120, executed_at: "2024-06-01" }),
  ]);
  assert.equal(lots.length, 1);
  near(lots[0].costBasis, 1000, "unchanged for the ordinary single-currency case");
});

// --- Summary / filtering -------------------------------------------------------------------------

test("summarizeRealized splits short vs long and converts each lot at its own currency's rate", () => {
  const lots = computeRealizedLots([
    tx({ type: "buy", quantity: 1, price: 100, executed_at: "2022-01-01" }),
    tx({ type: "sell", quantity: 1, price: 150, executed_at: "2024-01-01" }), // long
    tx({ type: "buy", quantity: 1, price: 100, executed_at: "2024-02-01" }),
    tx({ type: "sell", quantity: 1, price: 110, executed_at: "2024-03-01" }), // short
  ]);
  const s = summarizeRealized(lots, () => 2); // every currency worth 2 base units
  near(s.longTermGain, 100, "50 gain x2");
  near(s.shortTermGain, 20, "10 gain x2");
  near(s.totalGain, 120, "total");
  assert.equal(s.lotCount, 2);
});

test("lotsInYear filters by CLOSE year, and realizedYears lists them newest first", () => {
  const lots = computeRealizedLots([
    tx({ type: "buy", quantity: 1, price: 10, executed_at: "2022-06-01" }),
    tx({ type: "sell", quantity: 1, price: 20, executed_at: "2023-06-01" }),
    tx({ type: "buy", quantity: 1, price: 10, executed_at: "2024-06-01" }),
    tx({ type: "sell", quantity: 1, price: 20, executed_at: "2025-06-01" }),
  ]);
  assert.equal(lotsInYear(lots, 2023).length, 1);
  assert.equal(lotsInYear(lots, 2024).length, 0, "the 2024 BUY is not a taxable event");
  assert.deepEqual(realizedYears(lots), [2025, 2023]);
});
