// CSV import — the one place a bug corrupts the user's own ledger rather than just displaying
// something wrong. Everything downstream (positions, tax, income) is computed from these rows, so
// a misparsed price or a shifted date is permanent until the user notices and re-imports.
//
// Deliberately runs in a NON-UTC timezone: the production functions run in UTC, which hides an
// entire class of date bug that a user's own machine would hit.
process.env.TZ = "America/New_York";

import "./_resolve.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";

const { parseTransactionsCsv, transactionDedupeKey, isValidSymbol, isValidExchange } = await import(
  "../lib/import/csv.ts"
);

const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg}: got ${a}, want ${b}`);
const one = (csv) => {
  const r = parseTransactionsCsv(csv);
  assert.equal(r.errors.length, 0, `unexpected errors: ${JSON.stringify(r.errors)}`);
  assert.equal(r.rows.length, 1, "expected exactly one row");
  return r.rows[0];
};

// --- Headers and aliases -------------------------------------------------------------------------

test("canonical headers parse", () => {
  const row = one("symbol,type,quantity,price,fees,date\nAAPL,buy,10,150.25,1.5,2024-03-01\n");
  assert.equal(row.symbol, "AAPL");
  assert.equal(row.type, "buy");
  near(row.quantity, 10, "qty");
  near(row.price, 150.25, "price");
  near(row.fees, 1.5, "fees");
  assert.equal(row.executed_at, "2024-03-01");
  assert.equal(row.exchange, "US", "exchange defaults to US");
});

test("broker header aliases and mixed case map onto canonical fields", () => {
  const row = one("Ticker, Side , Shares,Unit Price,Commission,Trade Date\nmsft,BOUGHT,5,400,0.99,2024-04-02\n");
  assert.equal(row.symbol, "MSFT", "symbol is upper-cased");
  assert.equal(row.type, "buy", "'BOUGHT' is a buy");
  near(row.price, 400, "price");
  near(row.fees, 0.99, "commission maps to fees");
});

// --- Number parsing ------------------------------------------------------------------------------

test("US thousands separators and currency symbols", () => {
  const row = one("symbol,type,quantity,price\nBRK.B,buy,1,\"$1,234.56\"\n");
  near(row.price, 1234.56, "US format");
});

test("European decimal comma is NOT read as a thousands separator", () => {
  // "1.234,56" means 1234.56. Stripping the comma yields 1.23456 — a ~1000x understatement that
  // no validation rejects, because 1.23456 is a perfectly plausible price.
  const row = one("symbol,type,quantity,price\nSAP,buy,1,\"1.234,56\"\n");
  near(row.price, 1234.56, "European format");
});

test("a bare decimal comma is a decimal, not a group separator", () => {
  const row = one("symbol,type,quantity,price\nSAP,buy,1,\"99,95\"\n");
  near(row.price, 99.95, "99,95 is ninety-nine and change");
});

test("an ambiguous 1,234 resolves to thousands (US-first default)", () => {
  const row = one("symbol,type,quantity,price\nAAA,buy,1,\"1,234\"\n");
  near(row.price, 1234, "three trailing digits read as a thousands group");
});

test("accounting-style parentheses mean negative, and a negative fee is rejected", () => {
  // "(50.00)" is -50. Stripping the parens silently turns a credit into a charge.
  const r = parseTransactionsCsv("symbol,type,quantity,price,fees\nAAA,buy,1,100,(50.00)\n");
  assert.equal(r.rows.length, 0, "a negative fee must not be accepted as +50");
  assert.match(r.errors[0].message, /fee/i);
});

test("blank price and fees default to zero rather than erroring", () => {
  const row = one("symbol,type,quantity,price,fees\nAAA,dividend,10,,\n");
  near(row.price, 0, "price");
  near(row.fees, 0, "fees");
});

test("junk numbers are reported, not silently coerced", () => {
  const r = parseTransactionsCsv("symbol,type,quantity,price\nAAA,buy,abc,100\n");
  assert.equal(r.rows.length, 0);
  assert.match(r.errors[0].message, /quantity/i);
});

// --- Dates ---------------------------------------------------------------------------------------

test("a UTC-midnight timestamp keeps its calendar day in a negative-offset timezone", () => {
  // new Date("...T00:00:00Z") read through local getters lands on the PREVIOUS day west of UTC.
  // A trade shifted a day back can cross a year boundary and land in the wrong tax year.
  const row = one("symbol,type,quantity,price,date\nAAA,buy,1,100,2024-01-15T00:00:00Z\n");
  assert.equal(row.executed_at, "2024-01-15");
});

test("a New Year's Day trade does not fall into the previous tax year", () => {
  const row = one("symbol,type,quantity,price,date\nAAA,sell,1,100,2025-01-01T00:00:00Z\n");
  assert.equal(row.executed_at, "2025-01-01", "must not become 2024-12-31");
});

test("plain ISO dates pass through untouched", () => {
  assert.equal(one("symbol,type,quantity,price,date\nAAA,buy,1,1,2024-06-30\n").executed_at, "2024-06-30");
});

test("US slash dates parse", () => {
  assert.equal(one("symbol,type,quantity,price,date\nAAA,buy,1,1,03/15/2024\n").executed_at, "2024-03-15");
});

test("an unparseable date is reported rather than guessed", () => {
  const r = parseTransactionsCsv("symbol,type,quantity,price,date\nAAA,buy,1,1,not-a-date\n");
  assert.equal(r.rows.length, 0);
  assert.match(r.errors[0].message, /date/i);
});

test("a missing date column leaves executed_at null for the caller to default", () => {
  assert.equal(one("symbol,type,quantity,price\nAAA,buy,1,1\n").executed_at, null);
});

// --- Type handling -------------------------------------------------------------------------------

test("with no type column at all, rows default to buy (a plain holdings list)", () => {
  assert.equal(one("symbol,quantity,price\nAAA,10,100\n").type, "buy");
});

test("a BLANK type cell in a file that HAS a type column is an error, not a silent buy", () => {
  // Defaulting here invents a purchase the user never made, in a file that clearly intended to
  // state a type for every row.
  const r = parseTransactionsCsv("symbol,type,quantity,price\nAAA,sell,1,100\nBBB,,1,100\n");
  assert.equal(r.rows.length, 1, "only the well-formed row imports");
  assert.equal(r.rows[0].symbol, "AAA");
  assert.equal(r.errors.length, 1);
  assert.match(r.errors[0].message, /type/i);
});

test("an unknown type is reported", () => {
  const r = parseTransactionsCsv("symbol,type,quantity,price\nAAA,transfer,1,100\n");
  assert.equal(r.rows.length, 0);
  assert.match(r.errors[0].message, /transfer/);
});

// --- Rows, blanks, errors ------------------------------------------------------------------------

test("truly blank lines are skipped; a row with data but no symbol is reported", () => {
  const r = parseTransactionsCsv("symbol,type,quantity,price\n\nAAA,buy,1,100\n,buy,5,50\n");
  assert.equal(r.rows.length, 1);
  assert.equal(r.errors.length, 1);
  assert.match(r.errors[0].message, /symbol/i);
});

test("error line numbers point at the real source line", () => {
  const r = parseTransactionsCsv("symbol,type,quantity,price\nAAA,buy,1,100\nBBB,buy,-5,100\n");
  assert.equal(r.errors[0].line, 3, "header is line 1, first data row line 2");
});

// --- Guardrails ----------------------------------------------------------------------------------

test("symbol and exchange guardrails accept real tickers and reject junk", () => {
  for (const s of ["AAPL", "BRK.B", "BTC-USD", "0700"]) assert.ok(isValidSymbol(s), s);
  for (const s of ["", "A".repeat(16), "AA PL", "<script>"]) assert.ok(!isValidSymbol(s), s);
  assert.ok(isValidExchange("LSE"));
  assert.ok(!isValidExchange("NOT AN EXCHANGE"));
});

// --- Idempotency ---------------------------------------------------------------------------------

test("a broker ref is the dedupe key when present", () => {
  const base = { type: "buy", instrument_id: "i1", executed_at: "2024-01-01", quantity: 1, price: 1, fees: 0 };
  assert.equal(transactionDedupeKey({ ...base, ref: "ABC" }), "ref:ABC");
  // The ref wins over the trade's details, so a corrected re-export of the same trade updates in
  // place instead of duplicating.
  assert.equal(
    transactionDedupeKey({ ...base, ref: "ABC", price: 999 }),
    transactionDedupeKey({ ...base, ref: "ABC" })
  );
});

test("without a ref, identical trades collapse and different ones do not", () => {
  const base = { ref: null, type: "buy", instrument_id: "i1", executed_at: "2024-01-01", quantity: 1, price: 10, fees: 0 };
  assert.equal(transactionDedupeKey(base), transactionDedupeKey({ ...base }), "re-importing the same file is idempotent");
  for (const diff of [{ quantity: 2 }, { price: 11 }, { fees: 1 }, { type: "sell" }, { executed_at: "2024-01-02" }, { instrument_id: "i2" }]) {
    assert.notEqual(
      transactionDedupeKey(base),
      transactionDedupeKey({ ...base, ...diff }),
      `a change in ${Object.keys(diff)[0]} must produce a distinct key`
    );
  }
});

// --- Reinvested dividends ------------------------------------------------------------------------
//
// Broker sync is owner-only, so for everyone else the CSV is the only way a reinvestment enters the
// ledger. It has to survive the trip.

test("a Dividend Reinvestment row imports as a purchase, not as income", () => {
  // Previously rejected outright: "Dividend Reinvestment" is not in the type alias table, so the
  // row failed as an unknown type and the shares never arrived.
  const { rows, errors } = parseTransactionsCsv(
    "symbol,type,quantity,price,date\nNVDA,Dividend Reinvestment,0.515,194.923,2026-06-26\n"
  );
  assert.equal(errors.length, 0, JSON.stringify(errors));
  assert.equal(rows[0].type, "buy");
  assert.equal(rows[0].drip, true);
  assert.equal(rows[0].quantity, 0.515);
});

test("the description carries it when the type column says only 'dividend'", () => {
  const { rows } = parseTransactionsCsv(
    "symbol,type,quantity,price,date,description\nNVDA,dividend,0.515,194.923,2026-06-26,NVIDIA CORPORATION DIVIDEND REINVESTMENT\n"
  );
  assert.equal(rows[0].type, "buy", "a purchase, not a second dividend");
  assert.equal(rows[0].drip, true);
});

test("an explicit drip column marks a plain buy", () => {
  const { rows } = parseTransactionsCsv(
    "symbol,type,quantity,price,date,drip\nKO,buy,1.2,60,2026-06-26,yes\n"
  );
  assert.equal(rows[0].type, "buy");
  assert.equal(rows[0].drip, true);
});

test("an ordinary dividend is untouched", () => {
  const { rows } = parseTransactionsCsv(
    "symbol,type,quantity,price,date\nKO,dividend,100,0.485,2026-06-26\n"
  );
  assert.equal(rows[0].type, "dividend");
  assert.equal(rows[0].drip, false);
});

test('"dip" in a note does not make a purchase a reinvestment', () => {
  const { rows } = parseTransactionsCsv(
    "symbol,type,quantity,price,date,note\nKO,buy,10,60,2026-06-26,bought the dip\n"
  );
  assert.equal(rows[0].drip, false);
});

test("only a purchase can carry the flag", () => {
  // A dividend row with a stray drip column must not be tagged: the payout is not the buy it funded,
  // and tagging both would double the reinvested share count anyone reads off the page.
  const { rows } = parseTransactionsCsv(
    "symbol,type,quantity,price,date,drip\nKO,dividend,100,0.485,2026-06-26,yes\n"
  );
  assert.equal(rows[0].type, "dividend");
  assert.equal(rows[0].drip, false);
});
