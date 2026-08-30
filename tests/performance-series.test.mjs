// Performance series — the value-over-time chart and the headline cards above it
// ("Net invested", "You +X%"), plus the dollar-for-dollar SPY comparison.
//
// This is the first screen anyone checks to answer "how am I doing", so a wrong number here is
// read as fact and acted on. Reconstructed from the ledger on every load — no stored snapshots —
// so the arithmetic below is the whole story.
import { test } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context);
    } catch (err) {
      if (!specifier.startsWith(".") || !context.parentURL) throw err;
      for (const ext of [".ts", ".tsx", "/index.ts"]) {
        const candidate = new URL(specifier + ext, context.parentURL);
        if (existsSync(fileURLToPath(candidate))) return { url: candidate.href, shortCircuit: true };
      }
      throw err;
    }
  },
});

const { buildPerformanceSeries, buildBenchmarkSeries, buildHoldingsBacktest } = await import(
  "../lib/performance/series.ts"
);

const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-6, `${msg}: got ${a}, want ${b}`);
const usd = () => 1;

function tx(o) {
  return { instrument_id: "i1", currency: "USD", fees: 0, ...o };
}
const closes = (...pairs) => pairs.map(([date, close]) => ({ date, close }));
const hist = (obj) => new Map(Object.entries(obj));
const ccy = (obj) => new Map(Object.entries(obj));

// --- Value line ----------------------------------------------------------------------------------

test("value on each date is shares held x that date's close", () => {
  const s = buildPerformanceSeries(
    [tx({ type: "buy", quantity: 10, price: 100, executed_at: "2024-01-01" })],
    hist({ i1: closes(["2024-01-01", 100], ["2024-02-01", 110], ["2024-03-01", 90]) }),
    ccy({ i1: "USD" }),
    usd,
    "2024-03-01"
  );
  assert.deepEqual(s.points.map((p) => p.date), ["2024-01-01", "2024-02-01", "2024-03-01"]);
  near(s.points[0].value, 1000, "at cost");
  near(s.points[1].value, 1100, "up");
  near(s.points[2].value, 900, "down");
});

test("shares bought mid-window are worth nothing before the buy date", () => {
  const s = buildPerformanceSeries(
    [tx({ type: "buy", quantity: 10, price: 100, executed_at: "2024-02-01" })],
    hist({ i1: closes(["2024-01-01", 100], ["2024-02-01", 100], ["2024-03-01", 120]) }),
    ccy({ i1: "USD" }),
    usd,
    "2024-03-01"
  );
  const byDate = Object.fromEntries(s.points.map((p) => [p.date, p.value]));
  near(byDate["2024-01-01"] ?? 0, 0, "held nothing yet");
  near(byDate["2024-03-01"], 1200, "held 10 after the buy");
});

test("closes are forward-filled: a date with no close uses the last known one", () => {
  const s = buildPerformanceSeries(
    [tx({ type: "buy", quantity: 1, price: 50, executed_at: "2024-01-01" }),
     { instrument_id: "i2", currency: "USD", fees: 0, type: "buy", quantity: 1, price: 10, executed_at: "2024-01-01" }],
    hist({
      i1: closes(["2024-01-01", 50], ["2024-02-01", 60]),
      i2: closes(["2024-01-01", 10]), // no February close
    }),
    ccy({ i1: "USD", i2: "USD" }),
    usd,
    "2024-02-01"
  );
  const feb = s.points.find((p) => p.date === "2024-02-01");
  near(feb.value, 70, "i2 carries its January close forward");
});

test("non-base currencies convert at their own rate", () => {
  const s = buildPerformanceSeries(
    [tx({ type: "buy", quantity: 10, price: 100, currency: "EUR", executed_at: "2024-01-01" })],
    hist({ i1: closes(["2024-01-01", 100]) }),
    ccy({ i1: "EUR" }),
    (c) => (c === "EUR" ? 1.1 : 1),
    "2024-01-01"
  );
  near(s.points[0].value, 1100, "1000 EUR at 1.1");
  near(s.endInvested, 1100, "invested converts too");
});

test("a live current value overrides the final point", () => {
  const s = buildPerformanceSeries(
    [tx({ type: "buy", quantity: 10, price: 100, executed_at: "2024-01-01" })],
    hist({ i1: closes(["2024-01-01", 100], ["2024-03-01", 110]) }),
    ccy({ i1: "USD" }),
    usd,
    "2024-03-01",
    new Map([["i1", 1234]])
  );
  near(s.endValue, 1234, "today uses the live cached value, not the weekly close");
});

// --- Invested line and the headline gain ---------------------------------------------------------

test("invested is buys plus fees, less sell proceeds net of fees", () => {
  const s = buildPerformanceSeries(
    [tx({ type: "buy", quantity: 10, price: 100, fees: 5, executed_at: "2024-01-01" }),
     tx({ type: "sell", quantity: 4, price: 120, fees: 3, executed_at: "2024-02-01" })],
    hist({ i1: closes(["2024-01-01", 100], ["2024-02-01", 120]) }),
    ccy({ i1: "USD" }),
    usd,
    "2024-02-01"
  );
  near(s.points[0].invested, 1005, "buy + fee");
  near(s.points[1].invested, 1005 - (480 - 3), "less net sale proceeds");
  near(s.endValue, 720, "6 shares left at 120");
});

test("dividends and cash movements do not move either line", () => {
  const s = buildPerformanceSeries(
    [tx({ type: "buy", quantity: 10, price: 100, executed_at: "2024-01-01" }),
     tx({ type: "dividend", quantity: 10, price: 2, executed_at: "2024-02-01" }),
     tx({ type: "deposit", quantity: 1, price: 5000, executed_at: "2024-02-01" })],
    hist({ i1: closes(["2024-01-01", 100], ["2024-02-01", 100]) }),
    ccy({ i1: "USD" }),
    usd,
    "2024-02-01"
  );
  near(s.endInvested, 1000, "only buys and sells count as invested");
  near(s.endValue, 1000, "dividends don't create shares");
});

test("a fully exited position at a profit reports that profit, not zero", () => {
  // Bought $1,000 of stock, sold it all for $1,500. Nothing is held, so value is 0 and net
  // invested is -500 — the user has taken out $500 more than they put in. Clamping invested at
  // zero collapses gain to (0 - 0) = 0 and tells someone who made $500 that they made nothing.
  const s = buildPerformanceSeries(
    [tx({ type: "buy", quantity: 100, price: 10, executed_at: "2024-01-01" }),
     tx({ type: "sell", quantity: 100, price: 15, executed_at: "2024-06-01" })],
    hist({ i1: closes(["2024-01-01", 10], ["2024-06-01", 15]) }),
    ccy({ i1: "USD" }),
    usd,
    "2024-06-01"
  );
  near(s.endValue, 0, "nothing held");
  near(s.endInvested, -500, "net invested is negative once you've withdrawn more than you put in");
  near(s.gain, 500, "the realized profit must survive to the headline card");
});

test("gain is value minus invested for a partially sold, still-held position", () => {
  const s = buildPerformanceSeries(
    [tx({ type: "buy", quantity: 100, price: 10, executed_at: "2024-01-01" }),
     tx({ type: "sell", quantity: 50, price: 15, executed_at: "2024-06-01" })],
    hist({ i1: closes(["2024-01-01", 10], ["2024-06-01", 15]) }),
    ccy({ i1: "USD" }),
    usd,
    "2024-06-01"
  );
  near(s.endValue, 750, "50 left at 15");
  near(s.endInvested, 250, "1000 in, 750 back out");
  near(s.gain, 500, "gain");
  near(s.gainPct, 200, "500 on 250 deployed");
});

test("an empty ledger produces a single point and no divide-by-zero", () => {
  const s = buildPerformanceSeries([], hist({}), ccy({}), usd, "2024-05-05");
  assert.equal(s.points.length, 1);
  near(s.endValue, 0, "value");
  near(s.gainPct, 0, "percent stays 0 rather than NaN or Infinity");
});

// --- Benchmark -----------------------------------------------------------------------------------

test("the benchmark buys SPY with the same cash on the same dates", () => {
  // $1,000 into SPY at 100 = 10 shares. By the time SPY is 150 that's worth $1,500.
  const b = buildBenchmarkSeries(
    [tx({ type: "buy", quantity: 10, price: 100, executed_at: "2024-01-01" })],
    closes(["2024-01-01", 100], ["2024-06-01", 150]),
    usd,
    ["2024-01-01", "2024-06-01"]
  );
  near(b.get("2024-01-01"), 1000, "at purchase");
  near(b.get("2024-06-01"), 1500, "SPY up 50%");
});

test("a sell redeems the equivalent SPY shares", () => {
  const b = buildBenchmarkSeries(
    [tx({ type: "buy", quantity: 10, price: 100, executed_at: "2024-01-01" }),
     tx({ type: "sell", quantity: 10, price: 100, executed_at: "2024-06-01" })],
    closes(["2024-01-01", 100], ["2024-06-01", 100]),
    usd,
    ["2024-06-01"]
  );
  near(b.get("2024-06-01"), 0, "in and out at the same price leaves nothing invested");
});

test("benchmark cash flows convert from the trade's own currency", () => {
  const b = buildBenchmarkSeries(
    [tx({ type: "buy", quantity: 10, price: 100, currency: "EUR", executed_at: "2024-01-01" })],
    closes(["2024-01-01", 100]),
    (c) => (c === "EUR" ? 1.1 : 1),
    ["2024-01-01"]
  );
  near(b.get("2024-01-01"), 1100, "1000 EUR is 1100 base into the index");
});

// --- Holdings backtest ---------------------------------------------------------------------------

test("the backtest prices today's basket back through history", () => {
  const bt = buildHoldingsBacktest(
    [{ instrument_id: "i1", shares: 10, currency: "USD" }],
    hist({ i1: closes(["2024-01-01", 80], ["2024-06-01", 100]) }),
    usd,
    "2024-06-01"
  );
  near(bt.startValue, 800, "today's 10 shares valued at January's close");
  near(bt.endValue, 1000, "and at June's");
});

test("the backtest ends on the live value when one is supplied", () => {
  const bt = buildHoldingsBacktest(
    [{ instrument_id: "i1", shares: 10, currency: "USD" }],
    hist({ i1: closes(["2024-01-01", 80], ["2024-06-01", 100]) }),
    usd,
    "2024-06-01",
    new Map([["i1", 1111]])
  );
  near(bt.endValue, 1111, "final point uses the live value");
});

test("the backtest ignores history after today", () => {
  const bt = buildHoldingsBacktest(
    [{ instrument_id: "i1", shares: 1, currency: "USD" }],
    hist({ i1: closes(["2024-01-01", 10], ["2099-01-01", 999]) }),
    usd,
    "2024-06-01"
  );
  assert.ok(!bt.points.some((p) => p.date > "2024-06-01"), "no future points");
});
