// Dividend income received, and the forward estimate.
process.env.TZ = "America/New_York";

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
        const c = new URL(specifier + ext, context.parentURL);
        if (existsSync(fileURLToPath(c))) return { url: c.href, shortCircuit: true };
      }
      throw err;
    }
  },
});

const { monthlyDividendHistory, annualDividendSummary } = await import("../lib/dividends/history.ts");

const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-6, `${msg}: got ${a}, want ${b}`);
const usd = () => 1;
const TODAY = "2026-08-15";
const tx = (o) => ({ currency: "USD", quantity: 100, price: 0.5, ...o });

// --- Monthly history -----------------------------------------------------------------------------

test("the window is the trailing N months, oldest first, ending this month", () => {
  const m = monthlyDividendHistory([], usd, TODAY, 24);
  assert.equal(m.length, 24);
  assert.equal(m[0].key, "2024-09");
  assert.equal(m[23].key, "2026-08");
  assert.equal(m[23].label, "Aug 26");
});

test("a payment is bucketed by its month, as shares x per-share", () => {
  const m = monthlyDividendHistory([tx({ executed_at: "2026-03-10" })], usd, TODAY, 24);
  near(m.find((x) => x.key === "2026-03").total, 50, "100 shares x $0.50");
});

test("several payments in one month add up", () => {
  const m = monthlyDividendHistory(
    [tx({ executed_at: "2026-03-10" }), tx({ executed_at: "2026-03-25", price: 0.25 })],
    usd, TODAY, 24
  );
  near(m.find((x) => x.key === "2026-03").total, 75, "50 + 25");
});

test("months with no payout stay in the series as zero", () => {
  // Dropping them would close the gap and make the income look steadier than it was.
  const m = monthlyDividendHistory([tx({ executed_at: "2026-03-10" })], usd, TODAY, 24);
  assert.equal(m.length, 24);
  near(m.find((x) => x.key === "2026-04").total, 0, "April paid nothing");
});

test("payments outside the window are excluded", () => {
  const m = monthlyDividendHistory([tx({ executed_at: "2020-01-10" })], usd, TODAY, 24);
  assert.ok(m.every((x) => x.total === 0));
});

test("each payment converts at its own currency's rate", () => {
  const m = monthlyDividendHistory(
    [tx({ executed_at: "2026-03-10", currency: "EUR" })],
    (c) => (c === "EUR" ? 1.1 : 1),
    TODAY, 24
  );
  near(m.find((x) => x.key === "2026-03").total, 55, "50 EUR at 1.1");
});

test("the window crosses a year boundary correctly", () => {
  const m = monthlyDividendHistory([], usd, "2026-01-15", 24);
  assert.equal(m[0].key, "2024-02");
  assert.equal(m[23].key, "2026-01");
});

test("malformed rows are skipped rather than poisoning a bucket", () => {
  const m = monthlyDividendHistory(
    [tx({ executed_at: "" }), tx({ executed_at: "not-a-date" }),
     tx({ executed_at: "2026-03-10", price: NaN }), tx({ executed_at: "2026-03-10" })],
    usd, TODAY, 24
  );
  near(m.find((x) => x.key === "2026-03").total, 50, "only the one good row counts");
});

// --- Annual summary ------------------------------------------------------------------------------

test("completed years report what was actually received", () => {
  const years = annualDividendSummary(
    [tx({ executed_at: "2024-06-01" }), tx({ executed_at: "2025-06-01", price: 1 })],
    usd, TODAY, 0, 2, 3
  );
  const y24 = years.find((y) => y.year === 2024);
  const y25 = years.find((y) => y.year === 2025);
  near(y24.total, 50, "2024");
  assert.equal(y24.basis, "actual");
  near(y25.total, 100, "2025");
  assert.equal(y25.basis, "actual");
});

test("the current year is banked income plus the rest of the year at the run rate", () => {
  // August: eight months banked, four to come. Run rate 1200/yr -> 400 remaining.
  const years = annualDividendSummary([tx({ executed_at: "2026-02-01", price: 1 })], usd, TODAY, 1200, 2, 3);
  const cur = years.find((y) => y.year === 2026);
  assert.equal(cur.basis, "partial");
  near(cur.total, 100 + 400, "banked 100, plus 4 months of 1200/yr");
});

test("future years carry the run rate flat and are labelled estimates", () => {
  const years = annualDividendSummary([], usd, TODAY, 1200, 2, 3);
  const future = years.filter((y) => y.year > 2026);
  assert.equal(future.length, 3);
  for (const y of future) {
    near(y.total, 1200, `${y.year}`);
    assert.equal(y.basis, "estimate", "never presented as fact");
  }
});

test("the run rate is not grown year over year", () => {
  // Compounding an assumed growth rate produces a number people plan around. Flat is the floor.
  const years = annualDividendSummary([], usd, TODAY, 1000, 0, 3).filter((y) => y.basis === "estimate");
  assert.equal(new Set(years.map((y) => y.total)).size, 1, "every projected year is the same");
});

test("the series runs in order with no gaps", () => {
  const years = annualDividendSummary([], usd, TODAY, 100, 2, 3);
  assert.deepEqual(years.map((y) => y.year), [2024, 2025, 2026, 2027, 2028, 2029]);
});

test("a December run reserves nothing for the rest of the year", () => {
  const years = annualDividendSummary([tx({ executed_at: "2026-01-01" })], usd, "2026-12-31", 1200, 1, 1);
  near(years.find((y) => y.year === 2026).total, 50, "the year is over — banked only");
});

test("no history and no holdings is all zeros, not a crash", () => {
  const years = annualDividendSummary([], usd, TODAY, 0, 2, 3);
  assert.ok(years.every((y) => y.total === 0));
});
