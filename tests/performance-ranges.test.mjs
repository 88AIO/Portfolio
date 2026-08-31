// Chart time-range presets. Date arithmetic, so: run in a non-UTC timezone, because reading a
// YYYY-MM-DD through a local Date shifts the day west of UTC and production runs in UTC where that
// never shows up.
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

const { rangeStart, filterByRange, tickFormatterFor, RANGE_PRESETS } = await import(
  "../lib/performance/ranges.ts"
);

const days = (from, n) => {
  const out = [];
  const base = Date.parse(`${from}T00:00:00Z`);
  for (let i = 0; i < n; i++) out.push({ date: new Date(base + i * 86400000).toISOString().slice(0, 10) });
  return out;
};

// --- Preset bounds -------------------------------------------------------------------------------

test("each preset resolves to the expected start date", () => {
  const today = "2026-08-30";
  assert.equal(rangeStart("1M", today), "2026-07-30");
  assert.equal(rangeStart("6M", today), "2026-02-28");
  assert.equal(rangeStart("1Y", today), "2025-08-30");
  assert.equal(rangeStart("5Y", today), "2021-08-30");
  assert.equal(rangeStart("YTD", today), "2026-01-01");
  assert.equal(rangeStart("MAX", today), null, "no lower bound");
});

test("month arithmetic clamps instead of rolling into the next month", () => {
  // Date.UTC(2026, 2 - 1, 31) rolls forward to 3 March. One month before 31 March is February.
  assert.equal(rangeStart("1M", "2026-03-31"), "2026-02-28");
  assert.equal(rangeStart("1M", "2024-03-31"), "2024-02-29", "leap year keeps the 29th");
  assert.equal(rangeStart("1M", "2026-05-31"), "2026-04-30");
});

test("subtracting months crosses year boundaries", () => {
  assert.equal(rangeStart("6M", "2026-03-15"), "2025-09-15");
  assert.equal(rangeStart("1Y", "2026-01-01"), "2025-01-01");
  assert.equal(rangeStart("5Y", "2026-03-01"), "2021-03-01");
});

test("YTD on January 1st starts that same day", () => {
  assert.equal(rangeStart("YTD", "2026-01-01"), "2026-01-01");
});

test("the preset list is shortest-first and does not include the custom escape hatch", () => {
  assert.deepEqual(RANGE_PRESETS.map((r) => r.key), ["1M", "6M", "YTD", "1Y", "5Y", "MAX"]);
});

// --- Filtering -----------------------------------------------------------------------------------

test("a preset keeps only points inside the window", () => {
  const pts = days("2026-01-01", 250); // through mid-September
  const ytd = filterByRange(pts, "YTD", "2026-08-30");
  assert.equal(ytd[0].date, "2026-01-01");
  assert.ok(ytd.every((p) => p.date >= "2026-01-01"));

  const m1 = filterByRange(pts, "1M", "2026-08-30");
  assert.ok(m1.every((p) => p.date >= "2026-07-30"), "nothing older than the bound");
  assert.ok(m1.length < pts.length, "and it actually narrowed");
});

test("Max returns everything untouched", () => {
  const pts = days("2020-01-01", 400);
  assert.equal(filterByRange(pts, "MAX", "2026-08-30").length, pts.length);
});

test("a custom range is inclusive at both ends", () => {
  const pts = days("2026-01-01", 120);
  const out = filterByRange(pts, "CUSTOM", "2026-08-30", { from: "2026-02-01", to: "2026-02-10" });
  assert.equal(out[0].date, "2026-02-01");
  assert.equal(out[out.length - 1].date, "2026-02-10");
  assert.equal(out.length, 10);
});

test("a backwards custom range is read as the span the user meant", () => {
  const pts = days("2026-01-01", 120);
  const out = filterByRange(pts, "CUSTOM", "2026-08-30", { from: "2026-02-10", to: "2026-02-01" });
  assert.equal(out.length, 10, "swapped, not empty");
});

test("an incomplete custom range shows everything rather than nothing", () => {
  const pts = days("2026-01-01", 30);
  assert.equal(filterByRange(pts, "CUSTOM", "2026-08-30", { from: "", to: "" }).length, 30);
  assert.equal(filterByRange(pts, "CUSTOM", "2026-08-30", undefined).length, 30);
});

test("a window too narrow to draw falls back to two points, never a blank frame", () => {
  // A chart with one point renders nothing, which reads as "no data" when the truth is
  // "nothing happened in this window".
  const pts = days("2026-01-01", 30);
  const out = filterByRange(pts, "CUSTOM", "2026-08-30", { from: "2030-01-01", to: "2030-01-02" });
  assert.equal(out.length, 2);
});

test("an empty series stays empty", () => {
  assert.deepEqual(filterByRange([], "1Y", "2026-08-30"), []);
});

// --- Axis labels ---------------------------------------------------------------------------------

test("a short window labels the day, since the month repeats and the year never changes", () => {
  const fmt = tickFormatterFor(days("2026-08-01", 30));
  assert.equal(fmt("2026-08-15"), "Aug 15");
});

test("a mid window labels month and year", () => {
  const fmt = tickFormatterFor(days("2025-01-01", 400));
  assert.equal(fmt("2025-03-15"), "Mar 25");
});

test("a multi-year window labels the year alone", () => {
  const fmt = tickFormatterFor(days("2021-01-01", 2000));
  assert.equal(fmt("2023-07-04"), "2023");
});

test("an empty series gets a formatter that does not crash", () => {
  assert.equal(tickFormatterFor([])("2026-01-01"), "2026-01-01");
});
