import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { ensurePortfolio } from "../actions";
import { getRates } from "@/lib/marketdata";
import { money, pct } from "@/lib/format";
import {
  buildPerformanceSeries,
  buildHoldingsBacktest,
  type PerfTransaction,
  type PerfClose,
} from "@/lib/performance/series";
import PerformanceChart from "@/components/PerformanceChart";
import PricesAsOf, { oldestPriceAsOf } from "@/components/PricesAsOf";

export const dynamic = "force-dynamic";

type Tx = {
  instrument_id: string;
  type: string;
  quantity: number;
  price: number;
  fees: number;
  currency: string;
  executed_at: string;
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

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export default async function PerformancePage() {
  const supabase = await createClient();
  const portfolio = await ensurePortfolio();
  const base = portfolio.base_currency || "USD";

  const [{ data: txData }, { data: posData }] = await Promise.all([
    supabase
      .from("transactions")
      .select("instrument_id, type, quantity, price, fees, currency, executed_at")
      .order("executed_at", { ascending: true }),
    supabase.from("positions").select("instrument_id, currency, shares, avg_cost, last_price, price_as_of"),
  ]);

  const txs = (txData ?? []) as Tx[];
  const positions = (posData ?? []) as Pos[];

  // Weekly closes for every instrument that appears in the ledger.
  const instrumentIds = [...new Set(txs.map((t) => t.instrument_id))];
  let history: Hist[] = [];
  if (instrumentIds.length) {
    const { data: histData } = await supabase
      .from("price_history")
      .select("instrument_id, d, close")
      .in("instrument_id", instrumentIds)
      .order("d", { ascending: true });
    history = (histData ?? []) as Hist[];
  }

  // FX for every currency we touch (transactions + current positions).
  const currencies = [...txs.map((t) => t.currency), ...positions.map((p) => p.currency)];
  const rates = await getRates(currencies, base);
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

  // We only have REAL trade history if some buy/sell predates today. Broker holdings arrive as a
  // single "today" snapshot (the broker sends current positions, not each purchase date), which
  // can't reconstruct a true value-over-time. In that case we show an honest "growth of your current
  // holdings" backtest — the basket you hold today, valued back through the price history.
  const hasRealHistory = txs.some((t) => (t.type === "buy" || t.type === "sell") && t.executed_at < today);

  let chartData: { date: string; value: number; invested: number }[];
  let endValue: number, endInvested: number, gain: number, gainPct: number, hasData: boolean;

  if (hasRealHistory) {
    const series = buildPerformanceSeries(txs as PerfTransaction[], historyById, currencyById, fx, today, currentValueById);
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
    endValue = mv; endInvested = cost; gain = mv - cost; gainPct = cost > 0 ? (gain / cost) * 100 : 0;
    // Flat cost-basis reference line alongside the value line.
    chartData = bt.points.map((p) => ({ date: p.date, value: Math.round(p.value), invested: Math.round(cost) }));
    hasData = bt.points.length >= 2 && mv > 0;
  }

  return (
    <main className="min-h-screen bg-slate-50 text-slate-800">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-2">
            <div className="h-7 w-7 rounded-full bg-gradient-to-br from-sky-400 to-indigo-500" />
            <span className="text-lg font-semibold">Performance</span>
          </div>
          <Link href="/dashboard" className="text-sm text-indigo-600 hover:underline">
            ← Back to dashboard
          </Link>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-6 py-8">
        <div className="mb-2 flex justify-end">
          <PricesAsOf asOf={oldestPriceAsOf(positions)} />
        </div>
        <div className="mb-4">
          <h1 className="text-xl font-bold tracking-tight text-slate-900">Performance</h1>
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
            label={hasRealHistory ? "Appreciation" : "Unrealized gain"}
            value={money(gain, base)}
            tone={gain >= 0 ? "up" : "down"}
          />
          <Card
            label="Return"
            value={pct(gainPct)}
            tone={gainPct >= 0 ? "up" : "down"}
          />
        </div>

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
            </div>
          </div>
          <p className="mb-4 max-w-2xl text-xs text-slate-400">
            {hasRealHistory ? (
              <>Reconstructed from your transactions and weekly closing prices. The gap between the two
              lines is your gain; dividends are counted separately on the Dividends page.</>
            ) : (
              <>Your broker sends your <em>current</em> holdings, not the date of each purchase — so this
              shows the stocks you hold <strong>today</strong>, valued back through the past year. It&apos;s a
              what-if to see how your basket has moved, not your exact day-by-day history.</>
            )}
          </p>

          {hasData ? (
            <PerformanceChart data={chartData} currency={base} />
          ) : (
            <div className="py-16 text-center text-sm text-slate-400">
              <p className="mb-2">Not enough price history to chart yet.</p>
              <p>
                Price history builds automatically each night — check back tomorrow, or add a few
                dividend-paying or long-held names and it&apos;ll fill in.
              </p>
            </div>
          )}
        </section>

        <p className="mt-4 text-center text-xs text-slate-400">
          A simple return on the money you put in — not a time-weighted or money-weighted (XIRR) figure.
          We&apos;d rather show a number we can stand behind than a confident wrong one.
        </p>
      </div>
    </main>
  );
}

function Card({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "up" | "down";
}) {
  const toneClass = tone === "up" ? "text-emerald-600" : tone === "down" ? "text-rose-600" : "text-slate-900";
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="text-xs uppercase tracking-wide text-slate-400">{label}</div>
      <div className={`mt-1 text-xl font-semibold ${toneClass}`}>{value}</div>
    </div>
  );
}
