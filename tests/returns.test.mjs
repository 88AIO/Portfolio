// Return measures behind the performance page's S&P 500 comparison: XIRR, time-weighted return,
// the benchmark's total-return index, and the same-money benchmark with dividends reinvested.
// Each case is one a reader can check by hand or against a spreadsheet.
import "./_resolve.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";

const {
  xirr, annualize, totalReturnIndex, seriesReturn, dividendsCover, timeWeightedReturn, investorFlows, openingLotValuer,
} = await import("../lib/performance/returns.ts");
const { buildBenchmarkSeries } = await import("../lib/performance/series.ts");
const { lastCloseOfEachWeek, datesToReplace, weekStart } = await import("../lib/marketdata/weekly.ts");

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) < tol, `${msg}: got ${a}, want ${b}`);
const usd = () => 1;
const tx = (o) => ({ instrument_id: "i1", currency: "USD", fees: 0, ...o });
const closes = (...pairs) => pairs.map(([date, close]) => ({ date, close }));

// --- XIRR -----------------------------------------------------------------------------------------

test("xirr matches Excel's documented example (37.34%)", () => {
  const r = xirr([
    { date: "2008-01-01", amount: -10000 },
    { date: "2008-03-01", amount: 2750 },
    { date: "2008-10-30", amount: 4250 },
    { date: "2009-02-15", amount: 3250 },
    { date: "2009-04-01", amount: 2750 },
  ]);
  near(r, 0.373362535, 1e-6, "xirr");
});

test("xirr: $1,000 grown to $1,100 over exactly a year is 10%", () => {
  near(xirr([{ date: "2023-01-01", amount: -1000 }, { date: "2024-01-01", amount: 1100 }]), 0.1, 1e-4, "xirr");
});

test("xirr: a loss comes back negative, and one-sided flows have no answer", () => {
  near(xirr([{ date: "2023-01-01", amount: -1000 }, { date: "2024-01-01", amount: 800 }]), -0.2, 1e-3, "loss");
  assert.equal(xirr([{ date: "2023-01-01", amount: -1000 }]), null);
  assert.equal(xirr([{ date: "2023-01-01", amount: -1000 }, { date: "2024-01-01", amount: -5 }]), null);
});

test("annualize: only from a year up", () => {
  near(annualize(0.21, 730), 0.1, 1e-3, "21% over two years is ~10%/yr");
  assert.equal(annualize(0.05, 90), null);
  assert.equal(annualize(null, 900), null);
});

// --- Time-weighted return --------------------------------------------------------------------------

const twr = (txs, history, today, extra = {}) =>
  timeWeightedReturn({
    txs,
    historyById: new Map(Object.entries(history)),
    currencyById: new Map(Object.keys(history).map((k) => [k, "USD"])),
    fx: usd,
    today,
    includeDividends: true,
    ...extra,
  });

test("TWR ignores the size of a deposit: +10% then +10% is 21%, whatever was added in between", () => {
  // The textbook case. 100 grows 10%, then 1,000 more goes in and everything grows 10% again.
  // Simple return on money in reads ~10.9%; the investments did 21%.
  const r = twr(
    [
      tx({ type: "buy", quantity: 1, price: 100, executed_at: "2024-01-05" }),
      tx({ type: "buy", quantity: 9.090909090909092, price: 110, executed_at: "2024-01-12" }),
    ],
    { i1: closes(["2024-01-05", 100], ["2024-01-12", 110], ["2024-01-19", 121]) },
    "2024-01-19",
  );
  near(r.total, 0.21, 1e-9, "TWR");
});

test("TWR counts dividends as return", () => {
  // Flat price, a $5 dividend on a $100 holding: 5%.
  const r = twr(
    [
      tx({ type: "buy", quantity: 1, price: 100, executed_at: "2024-01-05" }),
      tx({ type: "dividend", quantity: 1, price: 5, executed_at: "2024-01-10" }),
    ],
    { i1: closes(["2024-01-05", 100], ["2024-01-12", 100]) },
    "2024-01-12",
  );
  near(r.total, 0.05, 1e-9, "TWR with income");
  const priceOnly = twr(
    [
      tx({ type: "buy", quantity: 1, price: 100, executed_at: "2024-01-05" }),
      tx({ type: "dividend", quantity: 1, price: 5, executed_at: "2024-01-10" }),
    ],
    { i1: closes(["2024-01-05", 100], ["2024-01-12", 100]) },
    "2024-01-12",
    { includeDividends: false },
  );
  near(priceOnly.total, 0, 1e-9, "price-only TWR");
});

test("TWR: a holding whose prices start late joins at its first close, with no fake jump", () => {
  // Bought in 2020 for 100; no price history until 2025, when it's worth 500. The 400 gained in
  // the unpriced years is not a one-week return — only what happens after the first close counts.
  const r = twr(
    [
      tx({ instrument_id: "a", type: "buy", quantity: 1, price: 100, executed_at: "2024-01-05" }),
      tx({ instrument_id: "late", type: "buy", quantity: 1, price: 100, executed_at: "2020-06-06" }),
    ],
    {
      a: closes(["2024-01-05", 100], ["2024-01-12", 100], ["2024-01-19", 100]),
      late: closes(["2024-01-12", 500], ["2024-01-19", 550]),
    },
    "2024-01-19",
  );
  // Week 1: flat. Week 2: 600 → 650 = +8.33%. Nothing from the unpriced years.
  near(r.total, 650 / 600 - 1, 1e-9, "TWR");
  assert.equal(r.discardedPeriods, 0);
});

test("TWR leaves never-priced holdings out and says how much", () => {
  const r = twr(
    [
      tx({ instrument_id: "a", type: "buy", quantity: 1, price: 100, executed_at: "2024-01-05" }),
      tx({ instrument_id: "ghost", type: "buy", quantity: 10, price: 1, executed_at: "2024-01-05" }),
    ],
    { a: closes(["2024-01-05", 100], ["2024-01-12", 110]) },
    "2024-01-12",
    { currentValueById: new Map([["a", 110], ["ghost", 7]]) },
  );
  near(r.total, 0.1, 1e-9, "TWR on the priced part");
  assert.equal(r.unpricedValue, 7);
});

test("TWR throws out an impossible week instead of chain-linking it", () => {
  const r = twr(
    [tx({ type: "buy", quantity: 1, price: 100, executed_at: "2024-01-05" })],
    { i1: closes(["2024-01-05", 100], ["2024-01-12", 10000], ["2024-01-19", 100]) },
    "2024-01-19",
  );
  assert.ok(r.discardedPeriods >= 1, "the ×100 week is discarded");
});

test("investorFlows: buys in, sales and dividends out, today's value last", () => {
  const f = investorFlows(
    [
      tx({ type: "buy", quantity: 2, price: 50, fees: 1, executed_at: "2024-01-01" }),
      tx({ type: "dividend", quantity: 2, price: 1, executed_at: "2024-06-01" }),
      tx({ type: "sell", quantity: 1, price: 60, fees: 1, executed_at: "2024-09-01" }),
    ],
    usd, "2025-01-01", 55, true,
  );
  assert.deepEqual(f.map((x) => x.amount), [-101, 2, 59, 55]);
});

test("a broker's opening-balance lot enters at market value, so old gains aren't recent return", () => {
  // Bought years ago at $30 (the broker's average cost), reported as an opening lot on 2024-10-04
  // when the stock stood at $120, then flat. Counted at cost that's +300% in a week; the truth is 0%.
  const lot = tx({ type: "buy", quantity: 10, price: 30, executed_at: "2024-10-04", dedupe_key: "ref:snaptrade-recon:x" });
  const history = { i1: closes(["2024-10-04", 120], ["2024-10-11", 120], ["2024-10-18", 120]) };
  const r = twr([lot], history, "2024-10-18");
  near(r.total, 0, 1e-9, "TWR");

  const value = openingLotValuer(new Map(Object.entries(history)), usd);
  near(value(lot), 1200, 1e-9, "market value on the lot date");
  assert.equal(value(tx({ type: "buy", quantity: 1, price: 30, executed_at: "2024-10-04" })), null, "an ordinary buy keeps its cost");
  const flows = investorFlows([lot], usd, "2025-10-04", 1200, true, value);
  assert.equal(flows[0].amount, -1200);
  near(xirr(flows), 0, 1e-6, "XIRR");
});

test("an opening lot dated mid-week takes that week's close, not its old cost", () => {
  // The broker window starts Monday 2024-03-04; history is weekly and starts Friday 2024-03-08, so
  // there is no close on or before the lot. Its fair value is that Friday's close.
  const lot = tx({ type: "buy", quantity: 10, price: 30, executed_at: "2024-03-04", dedupe_key: "ref:snaptrade-recon:x" });
  const value = openingLotValuer(new Map([["i1", closes(["2024-03-08", 120], ["2024-03-15", 121])]]), usd);
  near(value(lot), 1200, 1e-9, "valued at the week's close");
  const late = openingLotValuer(new Map([["i1", closes(["2024-04-19", 150])]]), usd);
  assert.equal(late(lot), null, "a first close weeks later is not the lot's value");
});

// --- Benchmark: total return ------------------------------------------------------------------------

test("total-return index reinvests each dividend at the ex-date close", () => {
  const tri = totalReturnIndex(
    closes(["2024-01-05", 100], ["2024-03-15", 100], ["2024-06-28", 110]),
    [{ exDate: "2024-03-15", amount: 2 }],
  );
  // One share + 2/100 reinvested = 1.02 units; at 110 that's 112.2 against 100 → +12.2%.
  near(seriesReturn(tri, "2024-01-05", "2024-06-28"), 0.122, 1e-9, "total return");
  near(seriesReturn(closes(["2024-01-05", 100], ["2024-06-28", 110]), "2024-01-05", "2024-06-28"), 0.1, 1e-9, "price return");
});

test("same-money benchmark reinvests SPY dividends; a buy on the ex-date doesn't get that one", () => {
  const spy = closes(["2024-01-05", 100], ["2024-03-15", 100], ["2024-06-28", 110]);
  const divs = [{ exDate: "2024-03-15", amount: 2 }];
  const price = buildBenchmarkSeries([tx({ type: "buy", quantity: 1, price: 1000, executed_at: "2024-01-05" })], spy, usd, ["2024-06-28"]);
  const total = buildBenchmarkSeries([tx({ type: "buy", quantity: 1, price: 1000, executed_at: "2024-01-05" })], spy, usd, ["2024-06-28"], divs);
  near(price.get("2024-06-28"), 1100, 1e-9, "price return");
  near(total.get("2024-06-28"), 1122, 1e-9, "total return");
  const exDayBuy = buildBenchmarkSeries([tx({ type: "buy", quantity: 1, price: 1000, executed_at: "2024-03-15" })], spy, usd, ["2024-06-28"], divs);
  near(exDayBuy.get("2024-06-28"), 1100, 1e-9, "bought on the ex-date: no dividend");
});

test("dividendsCover: history must reach back to the window's start", () => {
  assert.equal(dividendsCover([{ exDate: "2020-06-19", amount: 1 }], "2020-06-06"), true);
  assert.equal(dividendsCover([{ exDate: "2023-09-15", amount: 1 }], "2020-06-06"), false);
  assert.equal(dividendsCover([], "2020-06-06"), false);
});

// --- Weekly closes on their real dates ---------------------------------------------------------------

test("weekly closes keep each week's last completed trading day, dated when it happened", () => {
  const daily = closes(
    ["2026-09-14", 1], ["2026-09-15", 2], ["2026-09-18", 3], // Mon, Tue, Fri
    ["2026-09-21", 4], ["2026-09-23", 5], ["2026-09-24", 6], // Mon, Wed, Thu (today: still trading)
  );
  assert.deepEqual(lastCloseOfEachWeek(daily, "2026-09-24"), closes(["2026-09-18", 3], ["2026-09-23", 5]));
  assert.equal(weekStart("2026-09-18"), "2026-09-14");
  assert.equal(weekStart("2026-09-20"), "2026-09-14", "Sunday belongs to the week before");
});

test("datesToReplace clears leftovers inside the fetched window, and nothing on a gappy fetch", () => {
  const fetched = closes(["2026-09-04", 1], ["2026-09-11", 1], ["2026-09-18", 1], ["2026-09-25", 1]);
  const stored = ["2026-08-31", "2026-09-04", "2026-09-07", "2026-09-10", "2026-09-11", "2026-09-14", "2026-09-18", "2026-09-21", "2026-09-25"];
  // 08-31 is outside the window and stays; the Mondays and the Thursday intraday row go.
  assert.deepEqual(datesToReplace(fetched, stored), ["2026-09-07", "2026-09-10", "2026-09-14", "2026-09-21"]);
  const gappy = closes(["2026-01-02", 1], ["2026-09-25", 1]);
  assert.deepEqual(datesToReplace(gappy, stored), [], "two points over nine months is not a trustworthy window");
});
