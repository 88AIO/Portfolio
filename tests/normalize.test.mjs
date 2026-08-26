// Tests for the shared market-data normalization — the decisions that keep two providers agreeing
// about the same fact. These import the REAL module (Node strips the TypeScript), so unlike a
// mirrored copy they fail if the implementation drifts.
//
// Why these two functions are worth pinning: getting a minor-unit divisor wrong makes an LSE
// holding read 100x its value, and an inconsistent sector label silently splits one slice of the
// allocation chart into two.
import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeCurrency, canonicalSector } from "../lib/marketdata/normalize.ts";

test("minor units are converted to the major ISO unit", () => {
  // Yahoo writes pence as "GBp"; EODHD writes it as "GBX". Both are 1/100 GBP.
  assert.deepEqual(normalizeCurrency("GBp"), { currency: "GBP", divisor: 100 });
  assert.deepEqual(normalizeCurrency("GBX"), { currency: "GBP", divisor: 100 });
  assert.deepEqual(normalizeCurrency("ZAc"), { currency: "ZAR", divisor: 100 });
  assert.deepEqual(normalizeCurrency("ILa"), { currency: "ILS", divisor: 100 });
});

test("major units pass through undivided", () => {
  for (const c of ["USD", "GBP", "HKD", "EUR", "JPY"]) {
    assert.deepEqual(normalizeCurrency(c), { currency: c, divisor: 1 });
  }
});

test("a missing currency defaults to USD, never to a divisor", () => {
  assert.deepEqual(normalizeCurrency(null), { currency: "USD", divisor: 1 });
  assert.deepEqual(normalizeCurrency(undefined), { currency: "USD", divisor: 1 });
  assert.deepEqual(normalizeCurrency(""), { currency: "USD", divisor: 1 });
});

test("both providers' sector labels collapse to one canonical vocabulary", () => {
  // Yahoo's fund keys and EODHD's ETF keys must not produce two different slices.
  assert.equal(canonicalSector("consumer_cyclical"), canonicalSector("Consumer Cyclicals"));
  assert.equal(canonicalSector("financial_services"), canonicalSector("Financial Services"));
  assert.equal(canonicalSector("realestate"), canonicalSector("Real Estate"));
  assert.equal(canonicalSector("healthcare"), canonicalSector("Health Care"));
});

test("an unrecognised sector passes through rather than being dropped", () => {
  assert.equal(canonicalSector("Shipping Conglomerates"), "Shipping Conglomerates");
});
