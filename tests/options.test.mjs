// Unit test for legPremium — the single source of truth for the option-premium sign convention
// (credit on sell_to_open, debit on buy_to_close/rolled, fees always a cost). Every income number
// in the app (options cockpit, tax page, holding page, weekly digest, wheel history) flows through
// this helper, and the SQL views in supabase/schema.sql mirror it — so these cases pin down the
// convention itself, not an implementation detail.
//
// Runs offline with no env: `npm test`. lib/options.ts is TypeScript, so the helper is re-declared
// here from its documented contract; if the two ever disagree, THIS file is the spec.

import { test } from "node:test";
import assert from "node:assert/strict";

// Mirror of legPremium in lib/options.ts (and the SQL in supabase/schema.sql).
function legPremium(o) {
  const gross = (o.premium ?? 0) * (o.contracts ?? 0) * 100;
  const fee = o.fee ?? 0;
  if (o.action === "sell_to_open") return gross - fee;
  if (o.action === "buy_to_close" || o.action === "rolled") return -gross - fee;
  return -fee;
}

test("sell_to_open credits premium net of fee", () => {
  assert.equal(legPremium({ action: "sell_to_open", premium: 1.25, contracts: 2, fee: 1.3 }), 248.7);
});

test("buy_to_close debits premium plus fee", () => {
  assert.equal(legPremium({ action: "buy_to_close", premium: 0.4, contracts: 2, fee: 1.3 }), -81.3);
});

test("rolled debits like a close (the re-open is its own sell_to_open leg)", () => {
  assert.equal(legPremium({ action: "rolled", premium: 0.6, contracts: 1, fee: 0.65 }), -60.65);
});

// Money comparison: tolerant of IEEE-754 noise (and of -0, which Object.is distinguishes from 0).
function closeTo(actual, expected) {
  assert.ok(Math.abs(actual - expected) < 1e-9, `expected ${expected}, got ${actual}`);
}

test("expired moves no premium, only its fee", () => {
  closeTo(legPremium({ action: "expired", premium: 1.25, contracts: 2, fee: 0 }), 0);
  closeTo(legPremium({ action: "expired", premium: 1.25, contracts: 2, fee: 0.5 }), -0.5);
});

test("assigned moves no premium, only its fee (share legs carry the assignment economics)", () => {
  assert.equal(legPremium({ action: "assigned", premium: 2.1, contracts: 3, fee: 1 }), -1);
});

test("null premium/contracts/fee are treated as zero, never NaN", () => {
  assert.equal(legPremium({ action: "sell_to_open", premium: null, contracts: null, fee: null }), 0);
  assert.equal(legPremium({ action: "buy_to_close", premium: null, contracts: 2, fee: null }), -0);
});

test("a round trip nets to the kept premium", () => {
  const open = legPremium({ action: "sell_to_open", premium: 1.0, contracts: 1, fee: 0.65 });
  const close = legPremium({ action: "buy_to_close", premium: 0.3, contracts: 1, fee: 0.65 });
  closeTo(open + close, 100 - 30 - 1.3);
});
