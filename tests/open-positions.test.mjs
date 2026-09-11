// The open-lot cost basis — the TypeScript twin of the positions view's FIFO math in
// supabase/schema.sql. Both must answer the same question the same way: after selling, what did
// the shares you STILL hold cost you?
//
// The case that motivated it is the wheel seller's basic cycle: assigned at 50, called away at 55,
// assigned again at 52. The old "average of every buy" printed a $51 cost on a $52 lot, and its
// $200 "gain" overlapped the $500 realized gain shown beside it.

import "./_resolve.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";

const { computeOpenPositions, computeRealizedLots, summarizeRealized } = await import("../lib/tax/realized.ts");
const { computeOption } = await import("../lib/options.ts");

const tx = (type, quantity, price, executed_at, extra = {}) => ({
  symbol: "WHEEL", exchange: "US", currency: "USD", instrument_id: "i1", type, quantity, price, fees: 0, executed_at, ...extra,
});

function closeTo(actual, expected, msg) {
  assert.ok(Math.abs(actual - expected) < 1e-9, `${msg ?? ""} expected ${expected}, got ${actual}`);
}

test("a full wheel cycle leaves only the second lot's cost as the open basis", () => {
  const ledger = [tx("buy", 100, 50, "2024-01-10"), tx("sell", 100, 55, "2024-06-10"), tx("buy", 100, 52, "2025-01-10")];
  const [open] = computeOpenPositions(ledger);
  closeTo(open.shares, 100);
  closeTo(open.costBasis, 5200, "open cost");
  const realized = summarizeRealized(computeRealizedLots(ledger), () => 1);
  closeTo(realized.totalGain, 500, "realized");
  // Realized + unrealized never overlap: total P/L at $53 is 500 + (5300 − 5200) = 600.
  closeTo(realized.totalGain + (53 * open.shares - open.costBasis), 600, "total");
});

test("a partial sell consumes the oldest lot first and keeps the rest at their own cost", () => {
  const ledger = [tx("buy", 100, 10, "2024-01-10"), tx("buy", 100, 20, "2024-02-10"), tx("sell", 150, 25, "2024-03-10")];
  const [open] = computeOpenPositions(ledger);
  closeTo(open.shares, 50);
  closeTo(open.costBasis, 1000, "50 shares of the $20 lot");
});

test("buy fees fold into the open basis; a split scales shares, never money", () => {
  const splits = new Map([["i1", [{ exDate: "2024-03-01", ratio: 2 }]]]);
  const ledger = [
    tx("buy", 10, 100, "2024-01-10", { fees: 1 }), // 10 pre-split → 20 today, cost 1001
    tx("buy", 5, 55, "2024-04-10"),                  // post-split, 5 @ 55
    tx("sell", 5, 58, "2024-05-10"),                 // consumes 5 of the first lot (@ 50.05)
  ];
  const [open] = computeOpenPositions(ledger, splits);
  closeTo(open.shares, 20);
  closeTo(open.costBasis, 15 * 50.05 + 275, "matches the SQL view on the same rows");
});

test("a broker-restated opening balance is never split-adjusted again", () => {
  const splits = new Map([["i1", [{ exDate: "2024-03-01", ratio: 4 }]]]);
  const ledger = [tx("buy", 40, 25, "2024-01-10", { dedupe_key: "ref:snaptrade-recon:i1" })];
  const [open] = computeOpenPositions(ledger, splits);
  closeTo(open.shares, 40);
  closeTo(open.costBasis, 1000);
});

test("nothing held → empty basis, and an oversold position never reports negative cost", () => {
  const ledger = [tx("buy", 100, 10, "2024-01-10"), tx("sell", 150, 12, "2024-02-10")];
  const [open] = computeOpenPositions(ledger);
  closeTo(open.shares, 0);
  closeTo(open.costBasis, 0);
});

// The cushion is "how far the price would have to move to reach the strike", positive while OTM for
// BOTH types. Measuring calls as (price − strike) printed a comfortable OTM call as negative.
function row(option_type, strike, underlying_price) {
  return {
    portfolio_id: "p", instrument_id: "i1", symbol: "X", exchange: "US", name: null, option_type, strike,
    expiration: "2099-01-15", currency: "USD", net_contracts: 1, sold_contracts: 1, premium_net: 100,
    opened_at: "2026-01-01", last_action_at: "2026-01-01", underlying_price, underlying_shares: 100, dte: 30,
  };
}

test("cushion is positive when out of the money for puts AND calls", () => {
  closeTo(computeOption(row("put", 150, 180)).distanceToStrikePct, (30 / 180) * 100, "put 16.7% OTM");
  closeTo(computeOption(row("call", 200, 180)).distanceToStrikePct, (20 / 180) * 100, "call 11.1% OTM");
  assert.ok(computeOption(row("call", 170, 180)).distanceToStrikePct < 0, "an ITM call has negative cushion");
  assert.ok(computeOption(row("put", 190, 180)).distanceToStrikePct < 0, "an ITM put has negative cushion");
  assert.ok(computeOption(row("call", 170, 180)).inTheMoney && computeOption(row("put", 190, 180)).inTheMoney);
});
