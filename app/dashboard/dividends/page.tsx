import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { ensurePortfolio } from "../actions";
import { getRates } from "@/lib/marketdata";
import { money, pct } from "@/lib/format";
import { dividendSafety, type DividendSafety } from "@/lib/dividends/safety";
import { buildDividendCalendar } from "@/lib/dividends/calendar";
import SafetyBadge from "@/components/SafetyBadge";
import DividendCalendarChart from "@/components/DividendCalendarChart";
import PricesAsOf, { oldestPriceAsOf } from "@/components/PricesAsOf";

export const dynamic = "force-dynamic";

type Position = {
  instrument_id: string;
  symbol: string;
  name: string | null;
  currency: string;
  shares: number;
  last_price: number | null;
  price_as_of: string | null;
  annual_div_per_share: number | null;
  div_yield_current: number | null;
  div_frequency: number | null;
  next_dividend_date: string | null;
  next_dividend_per_share: number | null;
};

type DivRow = {
  instrument_id: string;
  ex_date: string | null;
  amount: number | null;
  currency: string | null;
};

export default async function DividendsPage() {
  const supabase = await createClient();
  const portfolio = await ensurePortfolio();

  // Consolidate across all of the user's portfolios (RLS scopes to the signed-in user).
  const { data: positions } = await supabase
    .from("positions")
    .select("*")
    .order("symbol");

  const rows = (positions ?? []) as Position[];
  const base = portfolio.base_currency || "USD";
  const rates = await getRates(rows.map((p) => p.currency), base);
  const fx = (ccy: string) => rates[ccy] ?? 1;

  // Forward income forecast: annual dividend per share × shares, per holding + total.
  const forecast = rows
    .map((p) => ({ p, annual: (p.annual_div_per_share ?? 0) * p.shares })) // annual in holding's currency
    .filter((h) => h.annual > 0)
    .sort((a, b) => b.annual * fx(b.p.currency) - a.annual * fx(a.p.currency));

  let annualIncome = 0;
  let marketValue = 0;
  for (const p of rows) {
    annualIncome += (p.annual_div_per_share ?? 0) * p.shares * fx(p.currency);
    marketValue += (p.last_price ?? 0) * p.shares * fx(p.currency);
  }
  const yieldOnValue = marketValue > 0 ? (annualIncome / marketValue) * 100 : 0;

  // Upcoming payouts: holdings with a future next-dividend date; estimate the amount when we can.
  const today = new Date().toISOString().slice(0, 10);
  const upcoming = rows
    .filter((p) => p.next_dividend_date && p.next_dividend_date >= today && p.shares > 0)
    .map((p) => {
      const perShare =
        p.next_dividend_per_share ??
        (p.annual_div_per_share && p.div_frequency ? p.annual_div_per_share / p.div_frequency : null);
      return { p, perShare, amount: perShare != null ? perShare * p.shares : null, date: p.next_dividend_date as string };
    })
    .sort((a, b) => a.date.localeCompare(b.date));

  // Forward 12-month dividend calendar — projected income rolled up by month (base currency).
  const calendar = buildDividendCalendar(rows, fx, today);
  const calendarChart = calendar.months.map((m) => ({
    label: m.label,
    short: m.label.slice(0, 3),
    total: m.total,
    count: m.events.length,
  }));
  const peakMonth = calendar.months.reduce(
    (best, m) => (m.total > best.total ? m : best),
    calendar.months[0]
  );

  // Full synced dividend history for the held instruments — powers both the recent list
  // and the per-holding dividend-safety score (computed from cuts / track record / growth).
  const ids = rows.map((r) => r.instrument_id);
  const byId = new Map(rows.map((r) => [r.instrument_id, r]));
  let recent: { date: string; symbol: string; perShare: number; total: number; currency: string }[] = [];
  const historyById = new Map<string, { exDate: string; amount: number }[]>();
  if (ids.length) {
    const { data: divs } = await supabase
      .from("dividends")
      .select("instrument_id, ex_date, amount, currency")
      .in("instrument_id", ids)
      .order("ex_date", { ascending: false });
    const all = (divs ?? []) as DivRow[];
    for (const d of all) {
      if (!d.ex_date || d.amount == null) continue;
      const arr = historyById.get(d.instrument_id) ?? [];
      arr.push({ exDate: d.ex_date, amount: d.amount });
      historyById.set(d.instrument_id, arr);
    }
    recent = all.slice(0, 15).map((d: DivRow) => {
      const p = byId.get(d.instrument_id);
      const perShare = d.amount ?? 0;
      return {
        date: d.ex_date ?? "—",
        symbol: p?.symbol ?? "?",
        perShare,
        total: perShare * (p?.shares ?? 0),
        currency: d.currency ?? p?.currency ?? base,
      };
    });
  }

  // Dividend safety per dividend-paying holding, sorted by score (unrated last).
  const safetyRows = rows
    .filter((p) => (p.annual_div_per_share ?? 0) > 0)
    .map((p) => ({
      p,
      safety: dividendSafety(historyById.get(p.instrument_id) ?? [], p.div_yield_current),
    }))
    .sort((a, b) => (b.safety.score ?? -1) - (a.safety.score ?? -1));
  const safetyById = new Map<string, DividendSafety>(
    safetyRows.map(({ p, safety }) => [p.instrument_id, safety])
  );

  return (
    <main className="min-h-screen bg-slate-50 text-slate-800">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-2">
            <div className="h-7 w-7 rounded-full bg-gradient-to-br from-sky-400 to-indigo-500" />
            <span className="text-lg font-semibold">Dividends</span>
          </div>
          <Link href="/dashboard" className="text-sm text-indigo-600 hover:underline">
            ← Back to dashboard
          </Link>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-6 py-8">
        {/* Forecast summary */}
        <div className="mb-2 flex justify-end">
          <PricesAsOf asOf={oldestPriceAsOf(rows)} />
        </div>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
          <Card label={`Est. annual income (${base})`} value={money(annualIncome, base)} />
          <Card label="Yield on value" value={pct(yieldOnValue)} />
          <Card label="Est. monthly avg" value={money(annualIncome / 12, base)} />
        </div>

        {/* Forward calendar — next 12 months of projected income by month */}
        <section className="mt-8 rounded-2xl border border-slate-200 bg-white p-5">
          <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="font-semibold">Dividend calendar</h2>
            <span className="text-xs text-slate-400">
              Next 12 months · {money(calendar.total, base)} projected
            </span>
          </div>
          <p className="mb-4 text-xs text-slate-400">
            Estimated payouts by month, projected from each holding&apos;s next ex-date and payout
            frequency.
            {calendar.untimedCount > 0 &&
              ` ${calendar.untimedCount} payer${calendar.untimedCount === 1 ? "" : "s"} with no known next date ${calendar.untimedCount === 1 ? "is" : "are"} not shown.`}
          </p>

          {calendar.total <= 0 ? (
            <p className="py-8 text-center text-sm text-slate-400">
              No projected payouts yet. Add dividend-paying holdings and hit “Refresh prices”.
            </p>
          ) : (
            <>
              <DividendCalendarChart data={calendarChart} currency={base} />
              {peakMonth.total > 0 && (
                <p className="mt-2 text-center text-xs text-slate-400">
                  Biggest month: <span className="font-medium text-slate-500">{peakMonth.label}</span>{" "}
                  ({money(peakMonth.total, base)})
                </p>
              )}

              {/* Month-by-month breakdown, depth on demand */}
              <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {calendar.months
                  .filter((m) => m.events.length > 0)
                  .map((m) => (
                    <div key={m.key} className="rounded-xl border border-slate-100 bg-slate-50/60 p-3">
                      <div className="mb-2 flex items-baseline justify-between">
                        <span className="text-sm font-medium">{m.label}</span>
                        <span className="text-sm font-semibold text-indigo-600">{money(m.total, base)}</span>
                      </div>
                      <ul className="space-y-1 text-xs text-slate-500">
                        {m.events.map((e, i) => (
                          <li key={`${e.instrument_id}-${i}`} className="flex justify-between gap-2">
                            <span>
                              <span className="font-medium text-slate-600">{e.symbol}</span>
                              <span className="text-slate-400"> · {e.date.slice(5)}</span>
                            </span>
                            <span className="tabular-nums">{money(e.amount, e.currency)}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
              </div>
            </>
          )}
        </section>

        <div className="mt-8 grid gap-6 lg:grid-cols-2">
          {/* Upcoming */}
          <section className="rounded-2xl border border-slate-200 bg-white p-5">
            <h2 className="mb-4 font-semibold">Upcoming payouts</h2>
            {upcoming.length === 0 ? (
              <p className="py-8 text-center text-sm text-slate-400">
                No upcoming ex-dividend dates yet. Add holdings and hit “Refresh prices”.
              </p>
            ) : (
              <ul className="divide-y divide-slate-100 text-sm">
                {upcoming.map(({ p, amount, date }) => (
                  <li key={p.instrument_id} className="flex items-center justify-between py-2.5">
                    <div>
                      <div className="font-medium">{p.symbol}</div>
                      <div className="text-xs text-slate-400">{date}</div>
                    </div>
                    <div className="text-right">
                      {amount != null ? money(amount, p.currency) : <span className="text-slate-300">—</span>}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Per-holding forecast */}
          <section className="rounded-2xl border border-slate-200 bg-white p-5">
            <h2 className="mb-4 font-semibold">Annual income by holding</h2>
            {forecast.length === 0 ? (
              <p className="py-8 text-center text-sm text-slate-400">No dividend-paying holdings yet.</p>
            ) : (
              <ul className="divide-y divide-slate-100 text-sm">
                {forecast.map(({ p, annual }) => {
                  const safety = safetyById.get(p.instrument_id);
                  return (
                    <li key={p.instrument_id} className="flex items-center justify-between py-2.5">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{p.symbol}</span>
                          {safety && <SafetyBadge safety={safety} />}
                        </div>
                        <div className="text-xs text-slate-400">
                          {money(p.annual_div_per_share ?? 0, p.currency)}/sh
                        </div>
                      </div>
                      <div className="text-right font-medium">{money(annual, p.currency)}</div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>

        {/* Dividend safety */}
        <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-5">
          <div className="mb-1 flex items-center justify-between gap-2">
            <h2 className="font-semibold">Dividend safety</h2>
            <span className="text-xs text-slate-400">0–100 · higher is steadier</span>
          </div>
          <p className="mb-4 max-w-2xl text-xs text-slate-400">
            A calm read on how dependable each payout looks, from its own history — past cuts,
            years paid, growth, and yield sanity. It informs, it doesn&apos;t advise. Holdings with
            little history stay unrated rather than guess.
          </p>
          {safetyRows.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-400">
              No dividend-paying holdings yet.
            </p>
          ) : (
            <ul className="divide-y divide-slate-100 text-sm">
              {safetyRows.map(({ p, safety }) => (
                <li key={p.instrument_id} className="flex flex-wrap items-center justify-between gap-y-1 py-3">
                  <div className="flex min-w-[9rem] items-center gap-2">
                    <span className="font-medium">{p.symbol}</span>
                    <SafetyBadge safety={safety} />
                  </div>
                  <div className="flex-1 text-right text-xs text-slate-500 sm:text-left sm:pl-6">
                    {safety.score != null
                      ? safety.factors.map((f) => f.detail).join(" · ")
                      : safety.summary}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Recent history */}
        <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-5">
          <h2 className="mb-4 font-semibold">Recent dividends</h2>
          {recent.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-400">
              No dividend history synced yet. It populates when you add holdings or refresh prices.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase text-slate-400">
                  <tr>
                    <th className="pb-2">Ex-date</th>
                    <th className="pb-2">Symbol</th>
                    <th className="pb-2 text-right">Per share</th>
                    <th className="pb-2 text-right">Total (at current shares)</th>
                  </tr>
                </thead>
                <tbody>
                  {recent.map((r, i) => (
                    <tr key={i} className="border-t border-slate-100">
                      <td className="py-2.5">{r.date}</td>
                      <td className="py-2.5 font-medium">{r.symbol}</td>
                      <td className="py-2.5 text-right">{money(r.perShare, r.currency)}</td>
                      <td className="py-2.5 text-right">{money(r.total, r.currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

function Card({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="text-xs uppercase tracking-wide text-slate-400">{label}</div>
      <div className="mt-1 text-xl font-semibold">{value}</div>
    </div>
  );
}
