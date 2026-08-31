// Stock splits: restating history in today's shares.
//
// The failure this guards against is not a rounding error. A 4-for-1 split that nobody records
// leaves a holding showing a quarter of its real share count against a present-day price — a large
// phantom loss on the dashboard, a broken FIFO match in realized gains, and a cliff in the value
// chart. Every case below is one of those.
process.env.TZ = "America/New_York";

import "./_resolve.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";

const { splitFactor, adjustQuantityPrice, adjustDividendPerShare, groupSplitsByInstrument } =
  await import("../lib/corporate/splits.ts");
const { computeRealizedLots } = await import("../lib/tax/realized.ts");

const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg}: got ${a}, want ${b}`);
const FOUR_FOR_ONE = [{ exDate: "2020-08-31", ratio: 4 }];

// --- splitFactor ---------------------------------------------------------------------------------

test("a split scales everything recorded before it", () => {
  near(splitFactor(FOUR_FOR_ONE, "2020-01-02"), 4, "bought before");
});

test("a split does not touch anything recorded after it", () => {
  near(splitFactor(FOUR_FOR_ONE, "2021-01-02"), 1, "bought after");
});

test("a trade ON the ex-date is already in post-split shares", () => {
  // The ex-date is the first session that trades at the new count, so counting the split again
  // would double it — 10 shares bought that morning would show as 40.
  near(splitFactor(FOUR_FOR_ONE, "2020-08-31"), 1, "bought on the day");
});

test("multiple splits compose", () => {
  const splits = [{ exDate: "2020-08-31", ratio: 4 }, { exDate: "2024-06-10", ratio: 2 }];
  near(splitFactor(splits, "2019-01-01"), 8, "before both");
  near(splitFactor(splits, "2021-01-01"), 2, "between them");
  near(splitFactor(splits, "2025-01-01"), 1, "after both");
});

test("a reverse split shrinks the share count", () => {
  near(splitFactor([{ exDate: "2023-05-01", ratio: 0.1 }], "2022-01-01"), 0.1, "1-for-10");
});

test("no splits is a no-op, so nothing changes for a holding that never split", () => {
  near(splitFactor([], "2020-01-01"), 1, "empty");
  near(splitFactor(undefined, "2020-01-01"), 1, "absent");
});

test("a nonsense ratio is ignored rather than applied", () => {
  // A zero or negative ratio would multiply a real holding into zero or a negative share count.
  // The table rejects one, but importers and providers also feed this.
  for (const bad of [0, -2, NaN, Infinity]) {
    near(splitFactor([{ exDate: "2025-01-01", ratio: bad }], "2020-01-01"), 1, `ratio ${bad}`);
  }
});

// --- quantity/price ------------------------------------------------------------------------------

test("quantity and price move in opposite directions, so the money is unchanged", () => {
  const { quantity, price } = adjustQuantityPrice(10, 500, FOUR_FOR_ONE, "2020-01-02");
  near(quantity, 40, "shares");
  near(price, 125, "per share");
  near(quantity * price, 5000, "what you actually paid is untouched");
});

// --- dividends -----------------------------------------------------------------------------------

test("a pre-split payout is restated per today's shares", () => {
  // Otherwise the safety score reads the split as a 75% dividend cut.
  near(adjustDividendPerShare(0.82, FOUR_FOR_ONE, "2020-02-07"), 0.205, "0.82 across 4x the shares");
});

test("a post-split payout is left alone", () => {
  near(adjustDividendPerShare(0.24, FOUR_FOR_ONE, "2024-02-09"), 0.24, "already current");
});

// --- grouping ------------------------------------------------------------------------------------

test("rows group by instrument, ascending, dropping unusable ones", () => {
  const map = groupSplitsByInstrument([
    { instrument_id: "b", ex_date: "2024-06-10", ratio: 2 },
    { instrument_id: "a", ex_date: "2022-01-01", ratio: 3 },
    { instrument_id: "a", ex_date: "2020-08-31", ratio: 4 },
    { instrument_id: "a", ex_date: null, ratio: 2 },
    { instrument_id: "a", ex_date: "2021-01-01", ratio: null },
  ]);
  assert.deepEqual(map.get("a").map((s) => s.exDate), ["2020-08-31", "2022-01-01"], "sorted, filtered");
  assert.equal(map.get("b").length, 1);
});

// --- FIFO realized gains -------------------------------------------------------------------------

const tx = (o) => ({ instrument_id: "i1", symbol: "AAPL", exchange: "US", currency: "USD", fees: 0, ...o });

test("a post-split sale matches against a pre-split buy", () => {
  // Buy 10 at $500 ($5,000), split 4-for-1, sell all 40 at $130 ($5,200). The gain is $200.
  // Unadjusted, FIFO covers only 10 of the 40 shares sold and books 30 as a zero-basis windfall —
  // reporting roughly $3,900 of profit that does not exist.
  const splits = new Map([["i1", FOUR_FOR_ONE]]);
  const lots = computeRealizedLots(
    [tx({ type: "buy", quantity: 10, price: 500, executed_at: "2020-01-02" }),
     tx({ type: "sell", quantity: 40, price: 130, executed_at: "2024-03-01" })],
    splits
  );
  const gain = lots.reduce((s, l) => s + l.gain, 0);
  near(gain, 200, "total realized gain");
  assert.equal(lots.length, 1, "one clean match, not a match plus an unmatched remainder");
  near(lots[0].quantity, 40, "reported in today's shares");
  assert.equal(lots[0].longTerm, true, "held from 2020 to 2024");
});

test("without split data the lots are fabricated, even where the total happens to net out", () => {
  // Pinned deliberately: this is what a missing split row still costs, and it is subtler than a
  // wrong total. FIFO covers only 10 of the 40 shares sold and books the other 30 at zero basis,
  // so the headline nets back to the same $200 by coincidence — proceeds minus the same consumed
  // basis — while the breakdown underneath it is invented: a $3,700 LONG-term loss beside a
  // $3,900 SHORT-term gain, in place of one $200 long-term gain. Anyone reading the short/long
  // split, or the per-lot rows on the holding page, is reading fiction.
  const lots = computeRealizedLots([
    tx({ type: "buy", quantity: 10, price: 500, executed_at: "2020-01-02" }),
    tx({ type: "sell", quantity: 40, price: 130, executed_at: "2024-03-01" }),
  ]);
  assert.equal(lots.length, 2, "one real match plus a phantom zero-basis lot");
  near(lots.reduce((s, l) => s + l.gain, 0), 200, "the total alone hides the problem");

  const shortTerm = lots.filter((l) => !l.longTerm).reduce((s, l) => s + l.gain, 0);
  const longTerm = lots.filter((l) => l.longTerm).reduce((s, l) => s + l.gain, 0);
  assert.ok(shortTerm > 3000, `phantom short-term gain (got ${shortTerm})`);
  assert.ok(longTerm < -3000, `phantom long-term loss (got ${longTerm})`);

  // The adjusted run gets the composition right, which is the point.
  const fixed = computeRealizedLots([
    tx({ type: "buy", quantity: 10, price: 500, executed_at: "2020-01-02" }),
    tx({ type: "sell", quantity: 40, price: 130, executed_at: "2024-03-01" }),
  ], new Map([["i1", FOUR_FOR_ONE]]));
  assert.equal(fixed.filter((l) => !l.longTerm).length, 0, "nothing short-term about it");
  near(fixed.reduce((s, l) => s + l.gain, 0), 200, "same total, honest lots");
});

test("a partial sale after a split consumes the right number of shares", () => {
  const splits = new Map([["i1", FOUR_FOR_ONE]]);
  const lots = computeRealizedLots(
    [tx({ type: "buy", quantity: 10, price: 500, executed_at: "2020-01-02" }),
     tx({ type: "sell", quantity: 10, price: 130, executed_at: "2024-03-01" })],
    splits
  );
  near(lots.reduce((s, l) => s + l.gain, 0), 10 * 130 - 10 * 125, "10 of 40 shares at $125 basis");
});

test("a split between two buys only scales the earlier one", () => {
  const splits = new Map([["i1", FOUR_FOR_ONE]]);
  const lots = computeRealizedLots(
    [tx({ type: "buy", quantity: 10, price: 500, executed_at: "2020-01-02" }),   // -> 40 @ $125
     tx({ type: "buy", quantity: 10, price: 130, executed_at: "2021-01-04" }),   // stays 10 @ $130
     tx({ type: "sell", quantity: 50, price: 140, executed_at: "2024-03-01" })],
    splits
  );
  near(lots.reduce((s, l) => s + l.gain, 0), 50 * 140 - (5000 + 1300), "both lots at their real basis");
  near(lots.reduce((s, l) => s + l.quantity, 0), 50, "50 shares closed");
});

test("fees still fold into basis after adjustment", () => {
  const splits = new Map([["i1", FOUR_FOR_ONE]]);
  const lots = computeRealizedLots(
    [tx({ type: "buy", quantity: 10, price: 500, fees: 10, executed_at: "2020-01-02" }),
     tx({ type: "sell", quantity: 40, price: 130, fees: 5, executed_at: "2024-03-01" })],
    splits
  );
  near(lots.reduce((s, l) => s + l.gain, 0), 5200 - 5 - 5010, "both commissions counted once");
});

test("a holding with no split data is matched exactly as before", () => {
  const lots = computeRealizedLots([
    tx({ type: "buy", quantity: 10, price: 100, executed_at: "2023-01-02" }),
    tx({ type: "sell", quantity: 10, price: 150, executed_at: "2024-03-01" }),
  ], new Map());
  near(lots.reduce((s, l) => s + l.gain, 0), 500, "unchanged");
});

// --- the value chart -----------------------------------------------------------------------------

const { buildPerformanceSeries } = await import("../lib/performance/series.ts");

test("the value line does not fall off a cliff on the split date", () => {
  // price_history stores the provider's ADJUSTED close, which is already restated in today's
  // shares. Multiplying an adjusted price by an unadjusted share count is the classic split bug:
  // the chart shows the position losing three quarters of its value overnight and never recovering.
  const txs = [{
    instrument_id: "i1", type: "buy", quantity: 10, price: 500, fees: 0,
    currency: "USD", executed_at: "2020-01-02",
  }];
  const closes = [
    { date: "2020-01-03", close: 125 },   // adjusted: $500 pre-split is $125 in today's shares
    { date: "2020-09-04", close: 130 },
    { date: "2024-03-01", close: 140 },
  ];
  const args = [
    txs,
    new Map([["i1", closes]]),
    new Map([["i1", "USD"]]),
    () => 1,
    "2024-03-01",
    undefined,
  ];

  const withSplit = buildPerformanceSeries(...args, new Map([["i1", FOUR_FOR_ONE]]));
  const values = withSplit.points.map((p) => p.value);
  near(values[0], 40 * 125, "40 of today's shares at the adjusted close");
  assert.ok(values.every((v) => v >= 4000), `no cliff: ${values.join(", ")}`);
  near(withSplit.endValue, 40 * 140, "ends at the real position value");

  // Without the split the same holding is valued at a quarter of itself throughout.
  const without = buildPerformanceSeries(...args);
  near(without.endValue, 10 * 140, "a quarter of the real value");
  assert.ok(without.endValue < withSplit.endValue / 3, "which is the bug");
});

test("net invested is untouched by a split, because no money moved", () => {
  const txs = [{
    instrument_id: "i1", type: "buy", quantity: 10, price: 500, fees: 0,
    currency: "USD", executed_at: "2020-01-02",
  }];
  const series = buildPerformanceSeries(
    txs,
    new Map([["i1", [{ date: "2024-03-01", close: 140 }]]]),
    new Map([["i1", "USD"]]),
    () => 1,
    "2024-03-01",
    undefined,
    new Map([["i1", FOUR_FOR_ONE]])
  );
  near(series.endInvested, 5000, "still the $5,000 that actually left the account");
});

// --- entering a split by hand --------------------------------------------------------------------

const { parseSplitRatio, MIN_RATIO, MAX_RATIO } = await import("../lib/corporate/splits.ts");
const { mergeSplits } = await import("../lib/corporate/splits.ts");

test("a split is accepted the way it is announced", () => {
  for (const input of ["4-for-1", "4 for 1", "4:1", "4/1", "4", "4-FOR-1"]) {
    near(parseSplitRatio(input), 4, `"${input}"`);
  }
});

test("a reverse split parses to a fraction, not its inverse", () => {
  // The whole reason the field takes text. Someone converting "1-for-10" to a decimal in their
  // head is one slip away from multiplying their holding by ten instead of dividing it.
  near(parseSplitRatio("1-for-10"), 0.1, "1-for-10");
  near(parseSplitRatio("1:10"), 0.1, "1:10");
});

test("an uneven ratio is kept exactly", () => {
  near(parseSplitRatio("3-for-2"), 1.5, "3-for-2");
});

test("nonsense is rejected rather than coerced to something plausible", () => {
  for (const input of ["", "  ", "abc", "0", "-4", "4-for-0", "0-for-4", "4-for-", "1/0"]) {
    assert.equal(parseSplitRatio(input), null, `"${input}" must not parse`);
  }
});

test("the sanity range excludes typos but admits every real split", () => {
  for (const real of ["4-for-1", "3-for-1", "20-for-1", "1-for-10", "1-for-100", "3-for-2"]) {
    const r = parseSplitRatio(real);
    assert.ok(r >= MIN_RATIO && r <= MAX_RATIO, `${real} should be allowed`);
  }
  assert.ok(parseSplitRatio("100000") > MAX_RATIO, "a fat-fingered ratio is out of range");
});

// --- merging provider rows with the user's own ---------------------------------------------------

const g = (ex_date, ratio, instrument_id = "i1") => ({ instrument_id, ex_date, ratio });
const own = (ex_date, ratio, o = {}) =>
  ({ instrument_id: "i1", ex_date, ratio, id: `m-${ex_date}`, created_at: "2026-01-01", note: null, ...o });

test("a user entry fills a gap the provider missed", () => {
  const merged = mergeSplits([], [own("2020-08-31", 4)]);
  assert.equal(merged.get("i1").length, 1);
  assert.equal(merged.get("i1")[0].source, "manual");
});

test("a user entry on the same date REPLACES the provider's, it does not compound", () => {
  // Applying both would scale the share count twice — 160 shares where there are 40 — which is a
  // worse error than the missing split the entry was made to fix.
  const merged = mergeSplits([g("2020-08-31", 4)], [own("2020-08-31", 7)]);
  const rows = merged.get("i1");
  assert.equal(rows.length, 1, "one split on one date");
  near(rows[0].ratio, 7, "the user's ratio wins");
  assert.equal(rows[0].source, "manual");
});

test("a ratio of 1 cancels a split the provider invented", () => {
  const merged = mergeSplits([g("2020-08-31", 4)], [own("2020-08-31", 1)]);
  near(splitFactor(merged.get("i1"), "2019-01-01"), 1, "no scaling at all");
});

test("provider rows on other dates survive an override", () => {
  const merged = mergeSplits(
    [g("2020-08-31", 4), g("2024-06-10", 2)],
    [own("2020-08-31", 1)]
  );
  const rows = merged.get("i1");
  assert.equal(rows.length, 2);
  near(splitFactor(rows, "2019-01-01"), 2, "only the untouched 2-for-1 applies");
});

test("the merged list is sorted and split by instrument", () => {
  const merged = mergeSplits(
    [g("2024-06-10", 2), g("2020-08-31", 4), g("2021-01-01", 3, "i2")],
    []
  );
  assert.deepEqual(merged.get("i1").map((r) => r.exDate), ["2020-08-31", "2024-06-10"]);
  assert.equal(merged.get("i2").length, 1);
});

test("a later user entry wins over an earlier one for the same date", () => {
  const merged = mergeSplits([], [
    own("2020-08-31", 4, { created_at: "2026-01-01" }),
    own("2020-08-31", 5, { created_at: "2026-02-01" }),
  ]);
  near(merged.get("i1")[0].ratio, 5, "the newer correction");
});

test("unusable rows are dropped from either source", () => {
  const merged = mergeSplits(
    [g(null, 4), g("2020-01-01", null), g("2020-02-01", 0)],
    [own(null, 4), own("2021-01-01", -1)]
  );
  assert.equal(merged.size, 0, "nothing usable");
});

// --- broker-reconciled rows -----------------------------------------------------------------------

const { isBrokerRestated } = await import("../lib/brokersync/restated.ts");

test("a broker's opening-balance lot is recognised", () => {
  assert.equal(isBrokerRestated("ref:snaptrade-recon:abc"), true);
  assert.equal(isBrokerRestated("ref:snaptrade-pos:abc"), true);
});

test("a real imported trade is not", () => {
  // The distinction the whole exemption rests on: activity rows are as-traded and DO need
  // adjusting; only the synthetic reconciling lot is already restated.
  assert.equal(isBrokerRestated("ref:snaptrade-act:xyz"), false);
  assert.equal(isBrokerRestated("csv:something"), false);
  assert.equal(isBrokerRestated(null), false);
  assert.equal(isBrokerRestated(undefined), false);
});

test("an opening balance is never split-adjusted a second time", () => {
  // It already equals the broker's CURRENT share count, splits included. Adjusting it again turns
  // a real 402-share position into a fictional 4,020-share one.
  const splits = new Map([["i1", [{ exDate: "2024-06-10", ratio: 10 }]]]);
  const lots = computeRealizedLots(
    [tx({ type: "buy", quantity: 400, price: 31, executed_at: "2024-01-02", dedupe_key: "ref:snaptrade-recon:i1" }),
     tx({ type: "sell", quantity: 400, price: 40, executed_at: "2026-03-01" })],
    splits
  );
  near(lots.reduce((s, l) => s + l.quantity, 0), 400, "400 shares closed, not 4,000");
  near(lots.reduce((s, l) => s + l.gain, 0), 400 * 40 - 400 * 31, "gain on the real position");
});

test("a real pre-split trade beside an opening balance is still adjusted", () => {
  // The exemption must be surgical: exempting everything would reintroduce the original bug.
  const splits = new Map([["i1", [{ exDate: "2024-06-10", ratio: 10 }]]]);
  const lots = computeRealizedLots(
    [tx({ type: "buy", quantity: 10, price: 300, executed_at: "2024-01-02", dedupe_key: "ref:snaptrade-act:1" }),
     tx({ type: "sell", quantity: 100, price: 40, executed_at: "2026-03-01" })],
    splits
  );
  near(lots.reduce((s, l) => s + l.quantity, 0), 100, "10 pre-split shares became 100");
  near(lots.reduce((s, l) => s + l.gain, 0), 100 * 40 - 3000, "basis preserved");
});

test("the value chart does not re-adjust an opening balance either", () => {
  const txs = [{
    instrument_id: "i1", type: "buy", quantity: 400, price: 31, fees: 0,
    currency: "USD", executed_at: "2024-01-02", dedupe_key: "ref:snaptrade-recon:i1",
  }];
  const series = buildPerformanceSeries(
    txs,
    new Map([["i1", [{ date: "2026-03-01", close: 40 }]]]),
    new Map([["i1", "USD"]]),
    () => 1,
    "2026-03-01",
    undefined,
    new Map([["i1", [{ exDate: "2024-06-10", ratio: 10 }]]])
  );
  near(series.endValue, 400 * 40, "valued at 400 shares, not 4,000");
});
