// Spotting a reinvested dividend.
import "./_resolve.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";

const { isDripBuy } = await import("../lib/dividends/drip.ts");

test("a broker's own wording marks the buy", () => {
  for (const note of [
    "DIVIDEND REINVESTMENT",
    "Reinvested dividend",
    "DRIP",
    "Qualified dividend reinvest",
    "dividend re-invested",
  ]) {
    assert.equal(isDripBuy("buy", note), true, `"${note}"`);
  }
});

test("an ordinary purchase is left alone", () => {
  for (const note of ["Bought on the dip", "market order", "", null, undefined]) {
    assert.equal(isDripBuy("buy", note), false, `"${note}"`);
  }
});

test('"dip" is not "drip"', () => {
  // The nearest miss, and the one that would quietly mislabel a real purchase.
  assert.equal(isDripBuy("buy", "bought the dip"), false);
});

test("only buys can be reinvestments", () => {
  // The dividend row itself is the payout, not the purchase it funded. Tagging both would double
  // the shares a reader thinks DRIP added.
  assert.equal(isDripBuy("dividend", "DIVIDEND REINVESTMENT"), false);
  assert.equal(isDripBuy("sell", "reinvestment"), false);
});
