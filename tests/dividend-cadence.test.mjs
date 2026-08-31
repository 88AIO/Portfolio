// Payout cadence, and the next ex-date when nobody has declared one.
//
// This module puts money on a calendar month that no company has actually announced, so the
// interesting cases here are the ones where it must REFUSE: a payer that has stopped, and a
// history too thin to read. A projected payment from a suspended dividend is exactly the
// confident-wrong number the product is built not to print.
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

const { inferDivFrequency, estimateNextExDate } = await import("../lib/dividends/cadence.ts");

/** `count` payments every `stepDays`, ending `endDate`, ascending. */
const series = (endDate, stepDays, count, amount = 0.25) => {
  const end = Date.parse(`${endDate}T00:00:00Z`);
  return Array.from({ length: count }, (_, i) => ({
    exDate: new Date(end - (count - 1 - i) * stepDays * 86_400_000).toISOString().slice(0, 10),
    amount,
  }));
};

// --- Frequency -----------------------------------------------------------------------------------

test("spacing snaps to a standard cadence", () => {
  assert.equal(inferDivFrequency(series("2026-06-15", 91, 8)), 4, "quarterly");
  assert.equal(inferDivFrequency(series("2026-06-15", 30, 8)), 12, "monthly");
  assert.equal(inferDivFrequency(series("2026-06-15", 182, 6)), 2, "semi-annual");
  assert.equal(inferDivFrequency(series("2026-06-15", 365, 5)), 1, "annual");
  assert.equal(inferDivFrequency(series("2026-06-15", 7, 12)), 52, "weekly");
});

test("an irregular gap does not shift the cadence", () => {
  // A quarterly payer that once paid two weeks late is still quarterly — the median gap decides,
  // so one odd spacing can't drag a 4x payer to 6x.
  const h = series("2026-06-15", 91, 8);
  h[4] = { ...h[4], exDate: "2026-01-02" };
  assert.equal(inferDivFrequency(h), 4);
});

test("a single payment can't establish a cadence", () => {
  assert.equal(inferDivFrequency([{ exDate: "2026-06-15", amount: 1 }]), 1);
  assert.equal(inferDivFrequency([]), null);
});

// --- Next date -----------------------------------------------------------------------------------

test("a quarterly payer's next date is one quarter past its last", () => {
  const next = estimateNextExDate(series("2026-06-15", 91, 8), "2026-08-31");
  assert.equal(next, "2026-09-15", "steps in whole months, keeping the day it pays on");
});

test("the estimate is never in the past", () => {
  const h = series("2026-06-15", 91, 8);
  for (const today of ["2026-06-16", "2026-08-31", "2026-09-15"]) {
    assert.ok(estimateNextExDate(h, today) >= today, `from ${today}`);
  }
});

test("a payment due today still counts as due", () => {
  // Ex-date is a deadline, not a past event, on the day itself.
  assert.equal(estimateNextExDate(series("2026-06-15", 91, 8), "2026-09-15"), "2026-09-15");
});

test("a monthly payer steps a month, not a quarter", () => {
  assert.equal(estimateNextExDate(series("2026-08-10", 30, 12), "2026-08-31"), "2026-09-10");
});

test("a weekly payer steps in days rather than collapsing to monthly", () => {
  const next = estimateNextExDate(series("2026-08-28", 7, 20), "2026-08-31");
  assert.equal(next, "2026-09-04", "seven days on, not a month");
});

test("the day is clamped to the target month's length", () => {
  // 31 Aug + 1 month must be 30 Sep, not 1 Oct. JavaScript rolls over by default.
  const h = [
    { exDate: "2026-06-30", amount: 1 },
    { exDate: "2026-07-31", amount: 1 },
    { exDate: "2026-08-31", amount: 1 },
  ];
  assert.equal(estimateNextExDate(h, "2026-09-01"), "2026-09-30");
});

test("a payer that has missed two cycles is treated as stopped, not overdue", () => {
  // The whole point: a suspended dividend must not keep appearing on the forward calendar as
  // income. Two full intervals of silence is enough to stop projecting.
  const quarterly = series("2026-01-15", 91, 8);
  assert.equal(estimateNextExDate(quarterly, "2026-04-01"), "2026-04-15", "one cycle late — still due");
  assert.equal(estimateNextExDate(quarterly, "2026-08-31"), null, "seven months of silence — no guess");
});

test("fewer than two payments gives no estimate", () => {
  assert.equal(estimateNextExDate([{ exDate: "2026-06-15", amount: 1 }], "2026-08-31"), null);
  assert.equal(estimateNextExDate([], "2026-08-31"), null);
});

test("zero-amount rows don't count as payments", () => {
  // Some feeds carry placeholder rows. Two of those are not a payment history.
  const h = [
    { exDate: "2026-03-15", amount: 0 },
    { exDate: "2026-06-15", amount: 0 },
    { exDate: "2026-08-15", amount: 1 },
  ];
  assert.equal(estimateNextExDate(h, "2026-08-31"), null, "only one real payment");
});

test("a malformed history returns null rather than an invalid date", () => {
  const h = [{ exDate: "not-a-date", amount: 1 }, { exDate: "also-not", amount: 1 }];
  const next = estimateNextExDate(h, "2026-08-31");
  assert.ok(next === null || /^\d{4}-\d{2}-\d{2}$/.test(next), `got ${next}`);
});

test("the estimate lands inside the twelve-month calendar window", () => {
  // Anything the calendar can't place is worse than useless — it inflates the untimed count
  // without adding income. Even an annual payer's next date must fall within a year.
  for (const [step, count] of [[365, 5], [182, 6], [91, 8], [30, 12], [7, 20]]) {
    const h = series("2026-08-20", step, count);
    const next = estimateNextExDate(h, "2026-08-31");
    assert.ok(next && next <= "2027-08-31", `${step}-day payer projected to ${next}`);
  }
});
