// Minor-unit divisor selection for the EODHD provider, tested through the real provider module.
//
// This is the single most dangerous number in the international path. EODHD's price endpoints
// return no currency, so the divisor is inferred. Getting it wrong produces a price that is
// exactly 100x off — a plausible-looking number that no downstream guard rejects, that no log line
// mentions, and that flows straight into portfolio value, cost basis, and tax figures.
//
// The rule under test: the EXCHANGE says which currency is quoted in a minor unit; the
// INSTRUMENT'S OWN currency says whether this listing is that currency. London is the case that
// forces the distinction — it carries USD- and EUR-denominated lines next to its pence ones.
import "./_resolve.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";

const { eodhdProvider } = await import("../lib/marketdata/providers/eodhd.ts");

// Drive the provider without a network: stub fetch to return one known close, then read back the
// price the provider produced. The ratio between them IS the divisor under test.
const RAW_CLOSE = 4321;

async function quotedPrice(exchange, knownCurrency) {
  const realFetch = globalThis.fetch;
  const realToken = process.env.EODHD_API_TOKEN;
  process.env.EODHD_API_TOKEN = "test-token";
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ close: RAW_CLOSE, change_p: 0 }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  try {
    const q = await eodhdProvider.getQuote("TEST", exchange, knownCurrency);
    return q.price;
  } finally {
    globalThis.fetch = realFetch;
    if (realToken === undefined) delete process.env.EODHD_API_TOKEN;
    else process.env.EODHD_API_TOKEN = realToken;
  }
}

test("US equity: never divided", async () => {
  assert.equal(await quotedPrice("US", "USD"), RAW_CLOSE);
});

test("LSE + GBP: divided by 100 (quoted in pence)", async () => {
  assert.equal(await quotedPrice("LSE", "GBP"), RAW_CLOSE / 100);
});

test("LSE + GBp/GBX spellings: still divided once, not twice", async () => {
  // normalizeCurrency maps both onto GBP; the divisor must not compound.
  assert.equal(await quotedPrice("LSE", "GBp"), RAW_CLOSE / 100);
  assert.equal(await quotedPrice("LSE", "GBX"), RAW_CLOSE / 100);
});

test("LSE + USD: NOT divided — the bug this rule exists to prevent", async () => {
  // A USD-denominated London line (ETF, depositary receipt). Under an exchange-only rule this
  // came back 100x too small, and nothing downstream would have questioned it.
  assert.equal(await quotedPrice("LSE", "USD"), RAW_CLOSE);
});

test("LSE + EUR: NOT divided", async () => {
  assert.equal(await quotedPrice("LSE", "EUR"), RAW_CLOSE);
});

test("JSE + ZAR divides; JSE + USD does not", async () => {
  assert.equal(await quotedPrice("JSE", "ZAR"), RAW_CLOSE / 100);
  assert.equal(await quotedPrice("JSE", "USD"), RAW_CLOSE);
});

test("Tel Aviv + ILS divides (agorot); + USD does not", async () => {
  assert.equal(await quotedPrice("TA", "ILS"), RAW_CLOSE / 100);
  assert.equal(await quotedPrice("TA", "USD"), RAW_CLOSE);
});

test("major-unit exchanges are never divided, whatever the currency", async () => {
  // Hong Kong, Tokyo, Sydney, Toronto, Singapore, Mumbai all quote in major units. Adding any of
  // them to the minor-unit map would manufacture a 100x error where none exists.
  for (const [exchange, currency] of [
    ["HK", "HKD"], ["TSE", "JPY"], ["AU", "AUD"],
    ["TO", "CAD"], ["SG", "SGD"], ["NSE", "INR"],
  ]) {
    assert.equal(await quotedPrice(exchange, currency), RAW_CLOSE, `${exchange}/${currency} must not be divided`);
  }
});

test("no known currency: falls back to the exchange's dominant convention", async () => {
  // The first quote for a brand-new instrument, before a currency is stored. London's dominant
  // convention is pence, so divide — the common case is right and the rare USD line self-corrects
  // on the next sync once searchInstrument has stored its currency.
  assert.equal(await quotedPrice("LSE", null), RAW_CLOSE / 100);
  assert.equal(await quotedPrice("LSE", undefined), RAW_CLOSE / 100);
  assert.equal(await quotedPrice("US", null), RAW_CLOSE);
});
