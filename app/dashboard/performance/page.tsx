import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/supabase/user";
import { createAdminClient } from "@/lib/supabase/admin";
import { ensurePortfolio } from "../actions";
import { getCachedRates } from "@/lib/fx";
import { money, pct } from "@/lib/format";
import {
  buildPerformanceSeries,
  buildHoldingsBacktest,
  buildBenchmarkSeries,
  benchmarkCoverage,
  investedAsOf,
  type PerfTransaction,
  type PerfClose,
} from "@/lib/performance/series";
import {
  annualize,
  dividendsCover,
  investorFlows,
  seriesReturn,
  timeWeightedReturn,
  totalReturnIndex,
  xirr,
  openingLotValuer,
  type Dividend,
} from "@/lib/performance/returns";
import { closeAsOf } from "@/lib/performance/series";
import { loadSplitsByInstrument } from "@/lib/corporate/load";
import PerformanceRange from "@/components/PerformanceRange";
import PricesAsOf, { oldestPriceAsOf } from "@/components/PricesAsOf";
import BackfillButton from "@/components/BackfillButton";
import { isBrokerSyncOwner } from "@/lib/brokersync";
import { fetchAll, fetchAllParallel } from "@/lib/supabase/paginate";
import { todayIso } from "@/lib/date";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // the one-time history backfill fetches several years of weekly closes

type Tx = {
  instrument_id: string;
  type: string;
  quantity: number;
  price: number;
  fees: number;
  currency: string;
  executed_at: string;
  // Marks a broker's opening-balance lot: already in today's shares (never split-adjusted again)
  // and counted at market value, not old cost, when measuring returns.
  dedupe_key: string | null;
};

type Pos = {
  instrument_id: string;
  currency: string;
  shares: number;
  avg_cost: number | null;
  last_price: number | null;
  price_as_of: string | null;
};

type Hist = { instrument_id: string; d: string; close: number };

export default async function PerformancePage() {
  const supabase = await createClient();
  const portfolio = await ensurePortfolio();
  const base = portfolio.base_currency || "USD";
  const user = await getCurrentUser();
  const isOwner = isBrokerSyncOwner(user?.email);

  // Transactions, live positions, and recorded daily snapshots are independent reads — fire them
  // together rather than one after another. Transactions can exceed Supabase's ~1000-row response cap
  // (years of trades + dividends), which would silently drop the newest rows and corrupt the share
  // timeline, so page through them all. Snapshots (portfolio_value_history) likewise grow unbounded.
  type Snap = { d: string; market_value: number | null };
  const [txs, { data: posData }, snapRows] = await Promise.all([
    fetchAll<Tx>((from, to) =>
      supabase
        .from("transactions")
        .select("instrument_id, type, quantity, price, fees, currency, executed_at, dedupe_key")
        .order("executed_at", { ascending: true })
        .order("instrument_id", { ascending: true })
        .range(from, to),
    ),
    supabase
      .from("positions")
      .select("instrument_id, currency, shares, avg_cost, last_price, price_as_of"),
    fetchAll<Snap>((from, to) =>
      supabase
        .from("portfolio_value_history")
        .select("d, market_value")
        .order("d", { ascending: true })
        .range(from, to),
    ),
  ]);
  const positions = (posData ?? []) as Pos[];

  // Weekly closes for every instrument that appears in the ledger, from the first trade onward.
  // NOTE: Supabase caps a single response at ~1000 rows. With years of weekly history across many
  // holdings that's far exceeded, and taking only the first 1000 (oldest) rows would silently drop
  // everything after — leaving the chart with no points inside the trading window. Count the range
  // once, then fetch every page CONCURRENTLY (fetchAllParallel). Skip closes predating the first
  // trade (the series never uses them).
  const instrumentIds = [...new Set(txs.map((t) => t.instrument_id))];
  const firstTradeDate = txs.reduce<string | null>(
    (min, t) => (t.type === "buy" || t.type === "sell") && (!min || t.executed_at < min) ? t.executed_at : min,
    null,
  );
  const priceHistoryPage = (from: number, to: number) => {
    let q = supabase
      .from("price_history")
      .select("instrument_id, d, close")
      .in("instrument_id", instrumentIds);
    if (firstTradeDate) q = q.gte("d", firstTradeDate);
    return q
      .order("d", { ascending: true })
      .order("instrument_id", { ascending: true })
      .range(from, to);
  };

  // Count the price-history range and read the FX cache concurrently; both feed the series build.
  const currencies = [...txs.map((t) => t.currency), ...positions.map((p) => p.currency)];
  const [histCount, rates] = await Promise.all([
    instrumentIds.length
      ? (async () => {
          let q = supabase
            .from("price_history")
            .select("*", { count: "exact", head: true })
            .in("instrument_id", instrumentIds);
          if (firstTradeDate) q = q.gte("d", firstTradeDate);
          const { count } = await q;
          return count ?? 0;
        })()
      : Promise.resolve(0),
    getCachedRates(supabase, currencies, base),
  ]);
  const history: Hist[] = histCount > 0 ? await fetchAllParallel<Hist>(priceHistoryPage, histCount) : [];
  const fx = (ccy: string) => rates[ccy] ?? 1;

  // Group closes by instrument (ascending).
  const historyById = new Map<string, PerfClose[]>();
  for (const h of history) {
    const arr = historyById.get(h.instrument_id) ?? [];
    arr.push({ date: h.d, close: h.close });
    historyById.set(h.instrument_id, arr);
  }

  // Currency per instrument (prefer the live position, fall back to the trade currency).
  const currencyById = new Map<string, string>();
  for (const t of txs) currencyById.set(t.instrument_id, t.currency);
  for (const p of positions) currencyById.set(p.instrument_id, p.currency);

  // Live base-currency value per instrument, for the chart's final "today" point.
  const currentValueById = new Map<string, number>();
  for (const p of positions) {
    if (p.last_price == null) continue;
    const v = p.last_price * p.shares * fx(p.currency);
    currentValueById.set(p.instrument_id, (currentValueById.get(p.instrument_id) ?? 0) + v);
  }

  const today = todayIso();

  // Recorded daily value snapshots (portfolio_value_history, fetched above) — an immutable, drift-proof
  // record of each account's value, written by the nightly sync for every account whether or not it
  // traded. These supersede the trade-based reconstruction for the dates they cover (the go-forward
  // source of truth); reconstruction still fills everything before the first snapshot. Summed across
  // accounts.
  const snapValueByDate = new Map<string, number>();
  for (const s of snapRows) snapValueByDate.set(s.d, (snapValueByDate.get(s.d) ?? 0) + (s.market_value ?? 0));
  const snapDates = [...snapValueByDate.keys()].sort();
  const firstSnapDate = snapDates[0] ?? null;

  // We only have REAL trade history if some buy/sell predates today. Broker holdings arrive as a
  // single "today" snapshot (the broker sends current positions, not each purchase date), which
  // can't reconstruct a true value-over-time. In that case we show an honest "growth of your current
  // holdings" backtest — the basket you hold today, valued back through the price history.
  // Splits restate historical share counts into today's shares. price_history stores the
  // provider's ADJUSTED close, so without this the value line drops off a cliff on every split
  // date and never comes back.
  const splitsById = await loadSplitsByInstrument(supabase, txs.map((t) => t.instrument_id));

  const hasRealHistory = txs.some((t) => (t.type === "buy" || t.type === "sell") && t.executed_at < today);

  let chartData: { date: string; value: number; invested: number; benchmark?: number; twr?: number; spy?: number }[];
  let endValue: number, endInvested: number, gain: number, gainPct: number | null, hasData: boolean;

  if (hasRealHistory) {
    const series = buildPerformanceSeries(txs as PerfTransaction[], historyById, currencyById, fx, today, currentValueById, splitsById);
    endValue = series.endValue; endInvested = series.endInvested; gain = series.gain; gainPct = series.gainPct;
    chartData = series.points.map((p) => ({ date: p.date, value: Math.round(p.value), invested: Math.round(p.invested) }));
    hasData = series.points.length >= 2 && series.endValue > 0;
  } else {
    const holdings = positions.map((p) => ({ instrument_id: p.instrument_id, shares: p.shares, currency: p.currency }));
    const bt = buildHoldingsBacktest(holdings, historyById, fx, today, currentValueById);
    let mv = 0, cost = 0;
    for (const p of positions) {
      mv += (p.last_price ?? 0) * p.shares * fx(p.currency);
      cost += (p.avg_cost ?? 0) * p.shares * fx(p.currency);
    }
    endValue = mv; endInvested = cost; gain = mv - cost; gainPct = cost > 0 ? (gain / cost) * 100 : null;
    // Flat cost-basis reference line alongside the value line.
    chartData = bt.points.map((p) => ({ date: p.date, value: Math.round(p.value), invested: Math.round(cost) }));
    hasData = bt.points.length >= 2 && mv > 0;
  }

  // Overlay the recorded daily snapshots for the dates they cover — exact and immutable, they replace
  // the reconstruction there. Net invested on each snapshot date is the ledger's own figure for that
  // date: holding it flat at today's value made a deposit inside the snapshot window look like a
  // market gain ("+$10,000 from the market" the week $10,000 was deposited). In backtest mode there
  // are no dated flows, so the flat cost reference is kept.
  if (firstSnapDate) {
    const snapPoints = snapDates.map((d) => ({
      date: d,
      value: Math.round(snapValueByDate.get(d) ?? 0),
      invested: Math.round(hasRealHistory ? investedAsOf(txs as PerfTransaction[], fx, d) : endInvested),
    }));
    chartData = [...chartData.filter((p) => p.date < firstSnapDate), ...snapPoints].sort((a, b) =>
      a.date.localeCompare(b.date),
    );
    hasData = chartData.length >= 2 && chartData[chartData.length - 1].value > 0;
  }

  // --- Returns the way brokers and index providers quote them (lib/performance/returns.ts) ---
  // Dividends received count as return; money added or taken out doesn't.
  const dividendsReceived = hasRealHistory
    ? txs.reduce((sum, t) => (t.type === "dividend" ? sum + t.quantity * t.price * fx(t.currency) : sum), 0)
    : 0;
  const twrOpts = { txs: txs as PerfTransaction[], historyById, currencyById, fx, today, currentValueById, splitsById };
  const openingLot = openingLotValuer(historyById, fx);
  const twr = hasRealHistory && hasData ? timeWeightedReturn({ ...twrOpts, includeDividends: true }) : null;
  const spanDays = twr?.start && twr.end ? (Date.parse(twr.end) - Date.parse(twr.start)) / 86_400_000 : 0;
  const twrAnnual = annualize(twr?.total ?? null, spanDays);
  const mwr = twr && spanDays >= 365 ? xirr(investorFlows(txs as PerfTransaction[], fx, today, endValue, true, openingLot)) : null;

  // --- S&P 500 benchmark: SPY with dividends reinvested, compared two ways ---
  //   • time-weighted: how your investments did vs the index, whatever you added when;
  //   • same money: the cash you actually deployed, on the dates you deployed it, put in SPY.
  // Only with real trade history (the backtest mode has no dated cash flows to mirror).
  type Bench = {
    totalReturn: boolean;
    you: number | null;
    spy: number | null;
    annual: boolean;
    youMwr: number | null;
    spyMwr: number | null;
  };
  let bench: Bench | null = null;
  let benchNote: string | null = null;
  if (twr?.start && twr.end) {
    // SPY is public benchmark reference data every user needs — read it with the service role so it
    // works even though the tightened `instruments` RLS policy only exposes a user's OWN instruments.
    // (price_history and dividends below stay on the RLS client; their authenticated-read policies
    // are unchanged.)
    const { data: spyInst } = await createAdminClient()
      .from("instruments").select("id").eq("symbol", "SPY").eq("exchange", "US").maybeSingle();
    const spyId = (spyInst as { id: string } | null)?.id;
    if (spyId) {
      const [spyRows, { data: spyDivRows }] = await Promise.all([
        fetchAll<{ d: string; close: number }>((from, to) =>
          supabase
            .from("price_history")
            .select("d, close")
            .eq("instrument_id", spyId)
            .order("d", { ascending: true })
            .range(from, to),
        ),
        supabase.from("dividends").select("ex_date, amount").eq("instrument_id", spyId).order("ex_date", { ascending: true }),
      ]);
      const benchCloses: PerfClose[] = spyRows.map((r) => ({ date: r.d, close: Number(r.close) }));
      const spyDivs: Dividend[] = ((spyDivRows ?? []) as { ex_date: string; amount: number }[]).map((d) => ({
        exDate: d.ex_date,
        amount: Number(d.amount),
      }));
      const coverage = benchmarkCoverage(txs as PerfTransaction[], benchCloses);
      if (benchCloses.length && coverage.uncoveredFlows === 0) {
        // Total return needs SPY's payouts back to your first trade. Until the nightly sync has
        // fetched them, both sides are compared on price alone rather than income against none.
        const totalReturn = dividendsCover(spyDivs, firstTradeDate);
        const yours = totalReturn ? twr : timeWeightedReturn({ ...twrOpts, includeDividends: false });
        const index = totalReturn ? totalReturnIndex(benchCloses, spyDivs) : benchCloses;
        const spyTotal = seriesReturn(index, twr.start, twr.end);
        const annual = spanDays >= 365;

        const benchByDate = buildBenchmarkSeries(
          txs as PerfTransaction[], benchCloses, fx, chartData.map((p) => p.date), totalReturn ? spyDivs : [], openingLot,
        );
        const benchEnd = benchByDate.get(chartData[chartData.length - 1].date) ?? 0;
        const spyMwr = annual && benchEnd > 0
          ? xirr(investorFlows(txs.filter((t) => t.type === "buy" || t.type === "sell") as PerfTransaction[], fx, today, benchEnd, false, openingLot))
          : null;
        const youMwr = annual ? xirr(investorFlows(txs as PerfTransaction[], fx, today, endValue, totalReturn, openingLot)) : null;

        // Per-point growth-of-1 for both, so the chart's range picker can show the time-weighted
        // comparison for whatever window is selected.
        chartData = chartData.map((p) => ({
          ...p,
          benchmark: Math.round(benchByDate.get(p.date) ?? 0),
          twr: p.date >= twr.start! ? closeAsOf(yours.points, p.date) ?? undefined : undefined,
          spy: p.date >= twr.start! ? closeAsOf(index, p.date) ?? undefined : undefined,
        }));
        bench = {
          totalReturn,
          you: annual ? annualize(yours.total, spanDays) : yours.total,
          spy: annual ? annualize(spyTotal, spanDays) : spyTotal,
          annual,
          youMwr,
          spyMwr,
        };
      } else if (benchCloses.length) {
        // A comparison that mirrors only some of the money is not a comparison. Say why it's missing
        // rather than print a flattering number.
        benchNote = `The S&P 500 comparison is hidden: ${coverage.uncoveredFlows} of your trades predate the S&P 500 price history we hold (from ${coverage.firstClose}), so the same-money benchmark can't mirror them honestly.`;
      }
    }
  }
  // The gap between two returns, in percentage points (a difference of percentages is not a percent).
  const pts = (x: number) => `${Math.abs(x * 100).toFixed(1)} pts`;
  const pctOf = (x: number | null) => (x == null ? "—" : pct(x * 100));

  return (
    <main className="flex-1 bg-slate-50 text-slate-800">
      <div className="mx-auto max-w-6xl px-6 py-8">
        <div className="mb-2 flex items-start justify-between gap-3">
          {isOwner ? <BackfillButton /> : <span />}
          <PricesAsOf asOf={oldestPriceAsOf(positions)} />
        </div>
        <div className="mb-4">
          <h1 className="font-display text-3xl font-medium tracking-tight text-slate-900">Performance</h1>
          <p className="mt-1 text-sm text-slate-500">
            {hasRealHistory
              ? "How your portfolio's value has moved over time."
              : "How the stocks you hold today have moved over the past year."}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <Card label="Worth now" value={money(endValue, base)} />
          <Card label={hasRealHistory ? "Net invested" : "What you paid"} value={money(endInvested, base)} />
          <Card
            label={hasRealHistory ? "Total gain" : "Unrealized gain"}
            value={money(gain + dividendsReceived, base)}
            tone={gain + dividendsReceived >= 0 ? "up" : "down"}
            sub={hasRealHistory && dividendsReceived > 0 ? `${money(gain, base)} price + ${money(dividendsReceived, base)} dividends` : undefined}
          />
          {twr?.total != null ? (
            <Card
              label={twrAnnual != null ? "Return per year" : "Return"}
              value={pctOf(twrAnnual ?? twr.total)}
              tone={(twrAnnual ?? twr.total) >= 0 ? "up" : "down"}
              sub={`time-weighted${mwr != null ? ` · your money ${pctOf(mwr)}/yr` : ""}`}
            />
          ) : (
            <Card
              label="Return"
              value={pct(gainPct)}
              tone={gainPct == null ? undefined : gainPct >= 0 ? "up" : "down"}
            />
          )}
        </div>

        {benchNote && <p className="mt-4 text-xs text-slate-500">{benchNote}</p>}

        {bench && bench.you != null && bench.spy != null && (
          <div className="mt-4 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="font-medium text-slate-700">
                vs. the S&amp;P 500{" "}
                <span className="text-slate-400">
                  ({bench.totalReturn ? "total return, dividends reinvested" : "price return"}, time-weighted{bench.annual ? ", per year" : ""})
                </span>
                :
              </span>
              <span className="tabular-nums">
                You <strong className={bench.you >= 0 ? "text-emerald-600" : "text-rose-600"}>{pctOf(bench.you)}</strong>
              </span>
              <span className="text-slate-300">·</span>
              <span className="tabular-nums">
                S&amp;P 500 <strong className={bench.spy >= 0 ? "text-emerald-600" : "text-rose-600"}>{pctOf(bench.spy)}</strong>
              </span>
              <span
                className={`ml-auto rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                  bench.you - bench.spy >= 0 ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"
                }`}
              >
                {bench.you - bench.spy >= 0 ? "Beating" : "Trailing"} the market by {pts(bench.you - bench.spy)}
                {bench.annual ? " a year" : ""}
              </span>
            </div>
            {bench.youMwr != null && bench.spyMwr != null && (
              <p className="mt-1.5 text-xs text-slate-500">
                Same money, same dates: your cash earned <strong className="tabular-nums">{pctOf(bench.youMwr)}</strong> a
                year; in the S&amp;P 500 it would have earned <strong className="tabular-nums">{pctOf(bench.spyMwr)}</strong>.
              </p>
            )}
            {!bench.totalReturn && (
              <p className="mt-1.5 text-xs text-slate-400">
                Dividends are left out on both sides until the S&amp;P 500&apos;s payout history reaches back to your first trade (it fills in overnight).
              </p>
            )}
          </div>
        )}

        <section className="mt-8 rounded-2xl border border-slate-200 bg-white p-5">
          <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-semibold">{hasRealHistory ? "Value over time" : "Growth of your holdings"}</h2>
            <div className="flex items-center gap-4 text-xs text-slate-400">
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-indigo-500" /> Value
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-0.5 w-4 border-t border-dashed border-slate-400" /> {hasRealHistory ? "Net invested" : "What you paid"}
              </span>
              {bench && (
                <span className="flex items-center gap-1.5">
                  <span className="h-0.5 w-4 border-t-2 border-[#b98a34]" /> S&amp;P 500
                </span>
              )}
            </div>
          </div>
          <p className="mb-4 max-w-2xl text-xs text-slate-400">
            {hasRealHistory ? (
              <>Reconstructed from your transactions and weekly closing prices. The gap between value and
              net invested is your price gain; dividends received are on top of it.
              {bench ? <> The S&amp;P 500 line is the same money, on the same dates, put into SPY{bench.totalReturn ? " with its dividends reinvested" : ""}; holdings your broker reported as an opening balance count at their market value that day.</> : null}</>
            ) : (
              <>Your broker sends your <em>current</em> holdings, not the date of each purchase, so this
              shows the stocks you hold <strong>today</strong>, valued back through the past year. It&apos;s a
              what-if to see how your basket has moved, not your exact day-by-day history.</>
            )}
          </p>

          {hasData ? (
            <PerformanceRange data={chartData} currency={base} dailyFrom={firstSnapDate} />
          ) : (
            <div className="py-16 text-center text-sm text-slate-400">
              <p className="mb-2">Not enough price history to chart yet.</p>
              <p>
                Price history builds automatically each night. Check back tomorrow, or add a few
                dividend-paying or long-held names and it&apos;ll fill in.
              </p>
            </div>
          )}
        </section>

        {hasRealHistory && twr?.total != null ? (
          <p className="mx-auto mt-4 max-w-3xl text-center text-xs text-slate-400">
            Return is time-weighted: each week between closing prices is measured on its own (Modified
            Dietz) and the weeks are chain-linked, so money you add or withdraw doesn&apos;t count as
            performance. &ldquo;Your money&rdquo; is money-weighted (XIRR). Both include dividends
            received; the S&amp;P 500 is SPY with dividends reinvested on the ex-date. Holdings your broker
            reported as an opening balance enter at their market value that day, so gains made before
            it don&apos;t count as recent performance. Past trades in other currencies are converted at
            today&apos;s rates.
            {twr.unpricedValue > 0 && <> {money(twr.unpricedValue, base)} of holdings with no price history is left out of the time-weighted figure.</>}
          </p>
        ) : (
          <p className="mt-4 text-center text-xs text-slate-400">
            A simple return on what you paid for the holdings you have today.
          </p>
        )}
      </div>
    </main>
  );
}

function Card({
  label,
  value,
  tone,
  sub,
}: {
  label: string;
  value: string;
  tone?: "up" | "down";
  sub?: string;
}) {
  const toneClass = tone === "up" ? "text-emerald-600" : tone === "down" ? "text-rose-600" : "text-slate-900";
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="text-xs uppercase tracking-wide text-slate-400">{label}</div>
      <div className={`mt-1 text-xl font-semibold ${toneClass}`}>{value}</div>
      {sub && <div className="mt-0.5 text-xs text-slate-400">{sub}</div>}
    </div>
  );
}
