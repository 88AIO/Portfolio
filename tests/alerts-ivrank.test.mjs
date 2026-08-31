// Alert content and IV Rank.
//
// buildAlerts decides which warnings reach a user's inbox — a miss is silence when something
// needed saying, a false positive trains people to ignore the emails. computeIvRank produces the
// IV column in the put finder, which is there to keep risk visible next to a tempting premium.
import "./_resolve.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";

const { buildAlerts } = await import("../lib/notifications/build.ts");
const { computeIvRank, IV_RANK_MIN_SAMPLES, IV_RANK_MIN_SPAN_DAYS, IV_RANK_WINDOW_DAYS } =
  await import("../lib/options/iv-rank.ts");

const TODAY = "2026-08-30";

const opt = (o = {}) => ({
  isOpen: true,
  status: "open",
  symbol: "AAPL",
  strike: 150,
  currency: "USD",
  option_type: "put",
  expiration: "2026-09-18",
  dte: 19,
  ...o,
});
const pos = (o = {}) => ({
  symbol: "SCHD",
  currency: "USD",
  shares: 100,
  next_dividend_date: null,
  next_dividend_per_share: 0.25,
  annual_div_per_share: 1,
  div_frequency: 4,
  ...o,
});

// --- Alerts --------------------------------------------------------------------------------------

test("a quiet day produces no alerts", () => {
  assert.deepEqual(buildAlerts([opt()], [pos()], TODAY), []);
});

test("an in-the-money option raises an assignment warning", () => {
  const items = buildAlerts([opt({ status: "may_be_assigned", dte: 5 })], [], TODAY);
  assert.equal(items.length, 1);
  assert.equal(items[0].severity, "warn");
  assert.match(items[0].text, /may be assigned/);
});

test("an option near expiry raises an informational note", () => {
  const items = buildAlerts([opt({ dte: 2 })], [], TODAY);
  assert.equal(items.length, 1);
  assert.equal(items[0].severity, "info");
  assert.match(items[0].text, /expires/);
});

test("assignment risk wins over the expiry note — one alert per option, not two", () => {
  const items = buildAlerts([opt({ status: "may_be_assigned", dte: 1 })], [], TODAY);
  assert.equal(items.length, 1, "the louder message replaces the quieter one");
  assert.equal(items[0].severity, "warn");
});

test("closed options never alert", () => {
  assert.deepEqual(buildAlerts([opt({ isOpen: false, status: "may_be_assigned", dte: 0 })], [], TODAY), []);
});

test("an already-expired option (negative dte) does not alert", () => {
  assert.deepEqual(buildAlerts([opt({ dte: -3 })], [], TODAY), []);
});

test("an ex-dividend inside three days alerts, with an estimated amount", () => {
  const items = buildAlerts([], [pos({ next_dividend_date: "2026-09-01" })], TODAY);
  assert.equal(items.length, 1);
  assert.match(items[0].text, /ex-dividend/);
  assert.match(items[0].text, /25/, "0.25 x 100 shares");
});

test("ex-dividends outside the window, in the past, or on shares you do not hold are skipped", () => {
  assert.deepEqual(buildAlerts([], [pos({ next_dividend_date: "2026-09-10" })], TODAY), [], "too far out");
  assert.deepEqual(buildAlerts([], [pos({ next_dividend_date: "2026-08-29" })], TODAY), [], "already passed");
  assert.deepEqual(buildAlerts([], [pos({ next_dividend_date: "2026-09-01", shares: 0 })], TODAY), [], "not held");
});

test("the ex-dividend window includes both boundary days", () => {
  assert.equal(buildAlerts([], [pos({ next_dividend_date: TODAY })], TODAY).length, 1, "today counts");
  assert.equal(buildAlerts([], [pos({ next_dividend_date: "2026-09-02" })], TODAY).length, 1, "day three counts");
});

test("a missing per-share estimate falls back to annual/frequency, and omits the figure if neither", () => {
  const derived = buildAlerts([], [pos({ next_dividend_date: "2026-09-01", next_dividend_per_share: null })], TODAY);
  assert.match(derived[0].text, /25/, "1.00/yr over 4 payments x 100 shares");

  const none = buildAlerts([], [pos({
    next_dividend_date: "2026-09-01", next_dividend_per_share: null, annual_div_per_share: null,
  })], TODAY);
  assert.doesNotMatch(none[0].text, /~/, "no invented number when nothing is known");
});

test("dedupe keys are stable per event so a daily cron never re-sends the same alert", () => {
  const a = buildAlerts([opt({ status: "may_be_assigned", dte: 5 })], [pos({ next_dividend_date: "2026-09-01" })], TODAY);
  const b = buildAlerts([opt({ status: "may_be_assigned", dte: 4 })], [pos({ next_dividend_date: "2026-09-01" })], "2026-08-31");
  assert.deepEqual(a.map((i) => i.dedupeKey), b.map((i) => i.dedupeKey), "keys must not move with the calendar");
  assert.equal(new Set(a.map((i) => i.dedupeKey)).size, a.length, "no collisions");
});

test("alerts come back in date order", () => {
  const items = buildAlerts(
    [opt({ dte: 2, expiration: "2026-09-01", strike: 1 }), opt({ dte: 0, expiration: "2026-08-30", strike: 2 })],
    [pos({ next_dividend_date: "2026-08-31" })],
    TODAY
  );
  assert.deepEqual(items.map((i) => i.date), ["2026-08-30", "2026-08-31", "2026-09-01"]);
});

// --- IV rank -------------------------------------------------------------------------------------

/** `n` daily samples ending the day before TODAY, values from `f`. */
function samples(n, f) {
  const out = [];
  for (let i = n; i >= 1; i--) {
    const d = new Date(Date.UTC(2026, 7, 30) - i * 86400000).toISOString().slice(0, 10);
    out.push({ captured_on: d, iv: f(n - i) });
  }
  return out;
}

test("too few samples reports building, not a rank", () => {
  const r = computeIvRank(samples(3, () => 20), 25, TODAY);
  assert.equal(r.rank, null);
  assert.ok(r.building);
});

test("enough samples but too short a span still reports building", () => {
  // Ten readings crammed into a few days say nothing about a 52-week range.
  const r = computeIvRank(samples(10, (i) => 20 + i), 25, TODAY);
  assert.ok(r.samples >= IV_RANK_MIN_SAMPLES);
  assert.equal(r.rank, null, `span under ${IV_RANK_MIN_SPAN_DAYS} days is not a range`);
  assert.ok(r.building);
});

test("a full history ranks today's IV within its own trailing range", () => {
  const hist = samples(60, (i) => 20 + (i % 21)); // 20..40 across two months
  const mid = computeIvRank(hist, 30, TODAY);
  assert.equal(mid.building, false);
  assert.ok(Math.abs(mid.rank - 50) < 1, `mid of 20..40 should rank ~50, got ${mid.rank}`);

  assert.equal(computeIvRank(hist, 20, TODAY).rank, 0, "at the low");
  assert.equal(computeIvRank(hist, 40, TODAY).rank, 100, "at the high");
});

test("today's reading is folded into the range, so a new extreme cannot rank above 100", () => {
  const r = computeIvRank(samples(60, (i) => 20 + (i % 21)), 80, TODAY);
  assert.equal(r.rank, 100, "a fresh high is the high");
  assert.equal(r.high, 80, "and it widens the range rather than being clipped against a stale one");
});

test("repeated same-day scans do not fake a range", () => {
  const dup = [
    ...samples(60, (i) => 20 + (i % 21)),
    { captured_on: "2026-08-29", iv: 999 },
    { captured_on: "2026-08-29", iv: 21 },
  ];
  const r = computeIvRank(dup, 30, TODAY);
  assert.ok(r.high < 999, "the later sample for a day replaces the earlier one");
});

test("samples outside the trailing window are ignored", () => {
  const stale = [{ captured_on: "2020-01-01", iv: 500 }, ...samples(60, (i) => 20 + (i % 21))];
  const r = computeIvRank(stale, 30, TODAY);
  assert.ok(r.high <= 40, `a ${IV_RANK_WINDOW_DAYS}-day window must exclude a 2020 reading`);
});

test("a flat history has no range to rank against", () => {
  const r = computeIvRank(samples(60, () => 25), 25, TODAY);
  assert.equal(r.rank, null, "high == low is not a range");
  assert.ok(r.building);
});

test("no current reading, no rank — but the window's range is still reported", () => {
  const r = computeIvRank(samples(60, (i) => 20 + (i % 21)), null, TODAY);
  assert.equal(r.rank, null);
  assert.equal(r.low, 20);
  assert.equal(r.high, 40);
});

test("an empty history is honest about having nothing", () => {
  const r = computeIvRank([], null, TODAY);
  assert.deepEqual(r, { rank: null, samples: 0, low: null, high: null, building: true });
});

test("junk samples are filtered rather than poisoning the range", () => {
  const r = computeIvRank(
    [...samples(60, (i) => 20 + (i % 21)), { captured_on: "2026-08-20", iv: NaN }, { captured_on: "2026-08-21", iv: -5 }],
    30,
    TODAY
  );
  assert.equal(r.building, false);
  assert.ok(r.low >= 20, "a negative IV is not a low");
});
