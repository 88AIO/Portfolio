// Dividend safety score + forward income calendar.
//
// The safety score is a 0-100 number shown next to a holding, and people will read it as a verdict
// on whether a dividend is dependable. The calendar answers "what income is coming, and when".
// Neither had tests.
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

const { dividendSafety } = await import("../lib/dividends/safety.ts");
const { buildDividendCalendar } = await import("../lib/dividends/calendar.ts");

// The module drops the current (partial) year, so build histories relative to it.
const THIS_YEAR = new Date().getUTCFullYear();
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-6, `${msg}: got ${a}, want ${b}`);

/** Four quarterly payments totalling `total` in the given year. */
function year(y, total) {
  return [3, 6, 9, 12].map((m) => ({
    exDate: `${y}-${String(m).padStart(2, "0")}-15`,
    amount: total / 4,
  }));
}
/** `n` complete years ending last year, each paying `amountFor(index)`. */
function history(n, amountFor) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(...year(THIS_YEAR - n + i, amountFor(i)));
  return out;
}

// =================================================================================================
// Dividend safety
// =================================================================================================

test("fewer than two complete years is unrated, not guessed", () => {
  const s = dividendSafety(history(1, () => 1), 3);
  assert.equal(s.score, null, "no confident number from one year");
  assert.equal(s.band, "unrated");
  assert.equal(s.factors.length, 0);
});

test("an empty history is unrated", () => {
  const s = dividendSafety([], 3);
  assert.equal(s.score, null);
  assert.equal(s.band, "unrated");
});

test("a long, growing, never-cut record with a normal yield scores near the top", () => {
  const s = dividendSafety(history(12, (i) => 1 + i * 0.06), 3);
  assert.ok(s.score >= 80, `expected very-safe, got ${s.score}`);
  assert.equal(s.band, "very-safe");
  assert.match(s.summary, /still growing/);
  assert.equal(s.factors.find((f) => f.key === "cuts").score, 1, "never cut");
});

test("a cut is detected, counted, and drags the score down", () => {
  const steady = dividendSafety(history(6, () => 1), 3);
  const cut = dividendSafety(history(6, (i) => (i === 4 ? 0.5 : 1)), 3);
  assert.ok(cut.score < steady.score, "a cut must score worse than an uninterrupted payer");
  assert.match(cut.factors.find((f) => f.key === "cuts").detail, /1 year down/);
  assert.match(cut.summary, /cut the payout/);
});

test("a recent cut is punished harder than an old one of the same depth", () => {
  const old = dividendSafety(history(8, (i) => (i === 1 ? 0.5 : 1)), 3);
  const recent = dividendSafety(history(8, (i) => (i === 7 ? 0.5 : 1)), 3);
  assert.ok(recent.score < old.score, `recent ${recent.score} should be worse than old ${old.score}`);
});

test("a SUSPENDED dividend counts as a cut, not as an unbroken record", () => {
  // Paid 4 years, stopped for 3, resumed at the old rate. Years with no payment simply have no
  // rows, so comparing consecutive ENTRIES steps straight from the last paying year to the
  // resumption and sees no drop — the single loudest warning a dividend can give, invisible.
  const paid = [...year(THIS_YEAR - 8, 1), ...year(THIS_YEAR - 7, 1), ...year(THIS_YEAR - 6, 1), ...year(THIS_YEAR - 5, 1),
                ...year(THIS_YEAR - 1, 1)];
  const s = dividendSafety(paid, 3);
  assert.ok(s.factors.find((f) => f.key === "cuts").score < 1, "the suspension must register as a cut");
  assert.doesNotMatch(s.summary, /Uninterrupted/, "must not claim an uninterrupted record");
});

test("a payer that has since STOPPED is not scored as if it still pays", () => {
  // Paid steadily through three years ago, nothing since. There are no rows for the missing years,
  // so nothing in the history says the payments stopped.
  const s = dividendSafety(history(6, () => 1).filter((p) => Number(p.exDate.slice(0, 4)) <= THIS_YEAR - 3), 3);
  assert.ok(s.factors.find((f) => f.key === "cuts").score < 1, "stopping paying is a cut to zero");
  assert.doesNotMatch(s.summary, /Uninterrupted/);
});

test("a very high yield is treated as a warning, not a bonus", () => {
  const normal = dividendSafety(history(6, () => 1), 4);
  const extreme = dividendSafety(history(6, () => 1), 15);
  assert.ok(extreme.score < normal.score, "a 15% yield should not outscore a 4% one");
  assert.ok(extreme.factors.find((f) => f.key === "yield").score < 0.3);
  assert.match(extreme.factors.find((f) => f.key === "yield").detail, /elevated/);
});

test("a missing yield neither rewards nor punishes, and is labelled honestly", () => {
  const s = dividendSafety(history(6, () => 1), null);
  const y = s.factors.find((f) => f.key === "yield");
  assert.equal(y.detail, "Yield unavailable");
  assert.ok(y.score > 0 && y.score < 1, "a neutral placeholder, not full or zero marks");
});

test("the current partial year is excluded from the record", () => {
  const withPartial = dividendSafety([...history(5, () => 1), ...year(THIS_YEAR, 0.25)], 3);
  const without = dividendSafety(history(5, () => 1), 3);
  assert.equal(withPartial.score, without.score, "a part-finished year must not read as a cut");
  assert.equal(withPartial.yearsOfHistory, 5);
});

test("every factor score stays within 0..1 and the total within 0..100", () => {
  for (const [h, y] of [
    [history(2, () => 1), 0],
    [history(20, (i) => 1 + i), 30],
    [history(5, (i) => 1 / (i + 1)), -5],
    [history(3, () => 0.0001), 0.1],
  ]) {
    const s = dividendSafety(h, y);
    assert.ok(s.score >= 0 && s.score <= 100, `score ${s.score} out of range`);
    for (const f of s.factors) {
      assert.ok(f.score >= 0 && f.score <= 1, `${f.key} = ${f.score} out of range`);
    }
  }
});

// =================================================================================================
// Forward dividend calendar
// =================================================================================================

const pos = (o) => ({
  instrument_id: "i1",
  symbol: "AAA",
  currency: "USD",
  shares: 100,
  annual_div_per_share: 4,
  div_frequency: 4,
  next_dividend_date: "2026-09-15",
  next_dividend_per_share: 1,
  ...o,
});
const usd = () => 1;
const TODAY = "2026-08-30";

test("the window is exactly 12 months starting with the current month", () => {
  const c = buildDividendCalendar([], usd, TODAY);
  assert.equal(c.months.length, 12);
  assert.equal(c.months[0].key, "2026-08");
  assert.equal(c.months[0].label, "Aug 2026");
  assert.equal(c.months[11].key, "2027-07");
});

test("a quarterly payer produces four events inside the window", () => {
  const c = buildDividendCalendar([pos()], usd, TODAY);
  const events = c.months.flatMap((m) => m.events);
  assert.equal(events.length, 4);
  assert.deepEqual(events.map((e) => e.date), ["2026-09-15", "2026-12-15", "2027-03-15", "2027-06-15"]);
  near(c.total, 400, "4 payments x $1 x 100 shares");
});

test("a monthly payer produces twelve, and an annual payer one", () => {
  // Anchored on a date still ahead of TODAY so all twelve land inside the window; a monthly payer
  // whose next date is mid-September only gets eleven, because this month's is already paid.
  const monthly = buildDividendCalendar(
    [pos({ div_frequency: 12, next_dividend_date: "2026-08-31", next_dividend_per_share: 1 / 3 })], usd, TODAY);
  const dates = monthly.months.flatMap((m) => m.events).map((e) => e.date);
  assert.equal(dates.length, 12);
  assert.equal(new Set(dates.map((d) => d.slice(0, 7))).size, 12, "one per month, no month doubled or skipped");

  const annual = buildDividendCalendar(
    [pos({ div_frequency: 1, next_dividend_per_share: 4 })], usd, TODAY);
  assert.equal(annual.months.flatMap((m) => m.events).length, 1);
});

test("a high-frequency payer steps in days, not months", () => {
  // A ~52x/yr distribution must not collapse to 12 monthly events.
  const c = buildDividendCalendar(
    [pos({ div_frequency: 52, next_dividend_per_share: 4 / 52 })], usd, TODAY);
  assert.ok(c.months.flatMap((m) => m.events).length > 40, "roughly weekly across the year");
});

test("a stale next-date is caught up, and nothing is placed in the past", () => {
  const c = buildDividendCalendar([pos({ next_dividend_date: "2024-03-15" })], usd, TODAY);
  const events = c.months.flatMap((m) => m.events);
  assert.ok(events.length > 0, "still projects forward");
  assert.ok(events.every((e) => e.date >= TODAY), "no event before today");
});

test("a payment earlier this month is already paid and is not counted as coming", () => {
  const c = buildDividendCalendar([pos({ next_dividend_date: "2026-08-01", div_frequency: 1 })], usd, TODAY);
  assert.ok(c.months[0].events.every((e) => e.date >= TODAY), "August 1st has passed");
});

test("an inferred anchor date is carried through to every event it generates", () => {
  // The calendar can't tell the difference on its own, and the UI must: "December, because they
  // declared it" and "December, because they always do" are different claims.
  const c = buildDividendCalendar([pos({ next_date_estimated: true })], usd, TODAY);
  const events = c.months.flatMap((m) => m.events);
  assert.ok(events.length > 0);
  assert.ok(events.every((e) => e.estimated), "every projection inherits the anchor's provenance");
  assert.equal(c.estimatedCount, 1);
  near(c.estimatedTotal, c.total, "all of it rests on an inferred date");
});

test("declared and inferred payers are totalled together but tallied apart", () => {
  const c = buildDividendCalendar(
    [pos(), pos({ instrument_id: "i2", symbol: "BBB", next_date_estimated: true })],
    usd, TODAY
  );
  assert.equal(c.estimatedCount, 1, "one of the two");
  near(c.total, 800, "both payers' income counts");
  near(c.estimatedTotal, 400, "half of it is inferred timing");
  for (const m of c.months) {
    near(m.estimatedTotal, m.events.filter((e) => e.estimated).reduce((s, e) => s + e.amountBase, 0),
      `${m.key} splits its own total`);
  }
});

test("a declared payer is never marked as estimated", () => {
  const c = buildDividendCalendar([pos()], usd, TODAY);
  assert.equal(c.estimatedCount, 0);
  near(c.estimatedTotal, 0, "nothing inferred");
  assert.ok(c.months.flatMap((m) => m.events).every((e) => e.estimated === false));
});

test("payers with no known next date or no frequency are counted, not guessed onto a month", () => {
  const c = buildDividendCalendar(
    [pos({ next_dividend_date: null }), pos({ div_frequency: null }), pos()], usd, TODAY);
  assert.equal(c.untimedCount, 2);
  assert.equal(c.months.flatMap((m) => m.events).length, 4, "only the timed payer is placed");
});

test("non-payers and empty positions are skipped without inflating untimedCount", () => {
  const c = buildDividendCalendar(
    [pos({ annual_div_per_share: 0 }), pos({ shares: 0 }), pos({ annual_div_per_share: null })], usd, TODAY);
  assert.equal(c.untimedCount, 0, "a stock that pays nothing is not an untimed dividend");
  assert.equal(c.total, 0);
});

test("amounts convert to the base currency while keeping the native figure", () => {
  const c = buildDividendCalendar([pos({ currency: "EUR" })], (ccy) => (ccy === "EUR" ? 1.1 : 1), TODAY);
  const e = c.months.flatMap((m) => m.events)[0];
  near(e.amount, 100, "native: $1 x 100 shares");
  near(e.amountBase, 110, "base: converted at 1.1");
  near(c.total, 440, "4 payments converted");
});

test("per-share falls back to annual/frequency when no next amount is known", () => {
  const c = buildDividendCalendar([pos({ next_dividend_per_share: null })], usd, TODAY);
  near(c.months.flatMap((m) => m.events)[0].perShare, 1, "4/yr over 4 payments");
});

test("month totals sum their events, and the window total sums the months", () => {
  const c = buildDividendCalendar([pos(), pos({ instrument_id: "i2", symbol: "BBB" })], usd, TODAY);
  for (const m of c.months) {
    near(m.total, m.events.reduce((s, e) => s + e.amountBase, 0), `${m.key} total`);
  }
  near(c.total, c.months.reduce((s, m) => s + m.total, 0), "window total");
});

test("events within a month are sorted by date", () => {
  const c = buildDividendCalendar(
    [pos({ next_dividend_date: "2026-09-20" }), pos({ instrument_id: "i2", symbol: "BBB", next_dividend_date: "2026-09-05" })],
    usd,
    TODAY
  );
  const sept = c.months.find((m) => m.key === "2026-09");
  assert.deepEqual(sept.events.map((e) => e.date), ["2026-09-05", "2026-09-20"]);
});

test("month-end dates land in the right month across a short February", () => {
  // Jan 31 + 1 month has to clamp somewhere; what matters is that it stays in February.
  const c = buildDividendCalendar(
    [pos({ next_dividend_date: "2027-01-31", div_frequency: 12, next_dividend_per_share: 1 })],
    usd,
    TODAY
  );
  const feb = c.months.find((m) => m.key === "2027-02");
  assert.equal(feb.events.length, 1, "exactly one February payment, not zero and not two");
});
