import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { ensurePortfolio } from "../actions";
import { getRates } from "@/lib/marketdata";
import { money, pct } from "@/lib/format";
import {
  buildPerformanceSeries,
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
    supabase.from("positions").select("instrument_id, currency, shares, last_price, price_as_of"),
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
  const series = buildPerformanceSeries(
    txs as PerfTransaction[],
    historyById,
    currencyById,
    fx,
    today,
    currentValueById
  );

  const hasData = series.points.length >= 2 && series.endValue > 0;
  const chartData = series.points.map((p) => ({
    date: p.date,
    value: Math.round(p.value),
    invested: Math.round(p.invested),
  }));

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
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <Card label={`Value (${base})`} value={money(series.endValue, base)} />
          <Card label="Net invested" value={money(series.endInvested, base)} />
          <Card
            label="Appreciation"
            value={money(series.gain, base)}
            tone={series.gain >= 0 ? "up" : "down"}
          />
          <Card
            label="Return on invested"
            value={pct(series.gainPct)}
            tone={series.gainPct >= 0 ? "up" : "down"}
          />
        </div>

        <section className="mt-8 rounded-2xl border border-slate-200 bg-white p-5">
          <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-semibold">Value over time</h2>
            <div className="flex items-center gap-4 text-xs text-slate-400">
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-indigo-500" /> Value
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-0.5 w-4 border-t border-dashed border-slate-400" /> Net invested
              </span>
            </div>
          </div>
          <p className="mb-4 max-w-2xl text-xs text-slate-400">
            Reconstructed from your transactions and weekly closing prices. The gap between the two
            lines is capital appreciation; dividends are counted separately on the Dividends page.
          </p>

          {hasData ? (
            <PerformanceChart data={chartData} currency={base} />
          ) : (
            <div className="py-16 text-center text-sm text-slate-400">
              <p className="mb-2">No price history yet to chart.</p>
              <p>
                Go to the dashboard and hit{" "}
                <span className="font-medium text-slate-500">“Refresh prices”</span> — it backfills
                about a year of weekly closes for your holdings.
              </p>
            </div>
          )}
        </section>

        <p className="mt-4 text-center text-xs text-slate-400">
          A simple return on the capital you deployed — not a time-weighted or money-weighted (XIRR)
          figure. We&apos;d rather show a number we can stand behind than a confident wrong one.
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
