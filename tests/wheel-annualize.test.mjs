// Annualizing a wheel's return.
//
// The failure mode is a headline number that is arithmetically correct and completely useless:
// two days of premium scaled by 182 reads as a triple-digit annual return.
import "./_resolve.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";

const { MIN_DAYS_TO_ANNUALIZE } = await import("../lib/options/wheel.ts");

test("the floor is a month, not a day", () => {
  // A day-old position annualizes by 365x. Anything below roughly a month says more about the
  // calendar than the position.
  assert.equal(MIN_DAYS_TO_ANNUALIZE, 30);
});

test("what the floor prevents", () => {
  // 1.5% collected over two days, annualized, is +273%. Printed beside real returns it reads as a
  // fact about the strategy rather than an artifact of the window.
  const naive = 0.015 * (365 / 2) * 100;
  assert.ok(naive > 250, `two-day annualization reaches ${naive.toFixed(0)}%`);
  assert.ok(2 < MIN_DAYS_TO_ANNUALIZE, "and is suppressed");
});
