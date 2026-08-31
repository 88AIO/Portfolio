import { createClient } from "@/lib/supabase/server";
import { ensurePortfolio } from "../actions";
import DashboardNav from "@/components/DashboardNav";
import { getCachedRates } from "@/lib/fx";
import { fetchAll } from "@/lib/supabase/paginate";
import { money, pct } from "@/lib/format";
import { dividendSafety, type DividendSafety } from "@/lib/dividends/safety";
import { buildDividendCalendar, type CalendarPosition } from "@/lib/dividends/calendar";
import { estimateNextExDate, inferDivFrequency } from "@/lib/dividends/cadence";
import { loadSplitsByInstrument } from "@/lib/corporate/load";
import { adjustDividendPerShare } from "@/lib/corporate/splits";
import { isBrokerCashDividend } from "@/lib/brokersync/restated";
import { monthlyDividendHistory, annualDividendSummary, type DividendTx } from "@/lib/dividends/history";
import SafetyBadge from "@/components/SafetyBadge";
import { DividendCalendarChart } from "@/components/charts";
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
  const rates = await getCachedRates(supabase, rows.map((p) => p.currency), base);
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

  const today = new Date().toISOString().slice(0, 10);

  // What the user was actually PAID, from their own ledger. This is a different number from the
  // instrument's payout history below: a 2024 payout multiplied by the shares held TODAY is not
  // what landed in the account, and shows income for a holding that may not have been owned yet.
  type DivTxRow = {
    executed_at: string | null;
    quantity: number | null;
    price: number | null;
    currency: string | null;
    dedupe_key: string | null;
    instruments: { symbol: string } | { symbol: string }[] | null;
  };
  const divTxRows = await fetchAll<DivTxRow>((from, to) =>
    supabase
      .from("transactions")
      .select("executed_at, quantity, price, currency, dedupe_key, instruments(symbol)")
      .eq("type", "dividend")
      .order("executed_at", { ascending: false })
      .range(from, to),
  );
  const divTxs: DividendTx[] = divTxRows
    .filter((t) => t.executed_at)
    .map((t) => ({
      executed_at: t.executed_at as string,
      quantity: t.quantity ?? 0,
      price: t.price ?? 0,
      currency: t.currency ?? base,
    }));
  const receivedMonthly = monthlyDividendHistory(divTxs, fx, today, 24);
  const receivedChart = receivedMonthly.map((m) => ({
    // "Aug" alone repeats twice across 24 months with nothing to tell the years apart.
    label: m.label,
    short: m.label,
    total: m.total,
    count: 0,
  }));
  const received24 = receivedMonthly.reduce((s, m) => s + m.total, 0);

  const byYear = annualDividendSummary(divTxs, fx, today, annualIncome, 2, 3);
  const paidRecently: { date: string; symbol: string; perShare: number | null; total: number; currency: string }[] = divTxRows.slice(0, 20).map((t) => {
    const rel = Array.isArray(t.instruments) ? t.instruments[0] : t.instruments;
    return {
      date: t.executed_at ?? "-",
      symbol: rel?.symbol ?? "?",
      // null rather than a number when the broker gave us a cash total: there is no per-share rate
      // to show, and printing the whole payment in that column invents one.
      perShare: isBrokerCashDividend("dividend", t.dedupe_key) ? null : (t.price ?? 0),
      total: (t.quantity ?? 0) * (t.price ?? 0),
      currency: t.currency ?? base,
    };
  });

  // Full synced dividend history for the held instruments — powers both the recent list
  // and the per-holding dividend-safety score (computed from cuts / track record / growth).
  const ids = rows.map((r) => r.instrument_id);
  const byId = new Map(rows.map((r) => [r.instrument_id, r]));
  let recent: { date: string; symbol: string; perShare: number; total: number; currency: string }[] = [];
  const historyById = new Map<string, { exDate: string; amount: number }[]>();
  if (ids.length) {
    // Full synced history feeds the safety scores, so it must NOT be truncated at Supabase's
    // ~1000-row response cap (years of payouts across many holdings exceed it). Page through it all.
    // Stable total ordering (ex_date desc, then instrument_id) keeps pages from overlapping.
    const all = await fetchAll<DivRow>((from, to) =>
      supabase
        .from("dividends")
        .select("instrument_id, ex_date, amount, currency")
        .in("instrument_id", ids)
        .order("ex_date", { ascending: false })
        .order("instrument_id", { ascending: true })
        .range(from, to),
    );
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
        date: d.ex_date ?? "-",
        symbol: p?.symbol ?? "?",
        perShare,
        total: perShare * (p?.shares ?? 0),
        currency: d.currency ?? p?.currency ?? base,
      };
    });
  }

  // Payout history ascending, which is what the cadence and safety maths read. The query above
  // orders newest-first for the "recent payments" list, so this is a reversed view of the same rows.
  const historyAsc = (id: string) => (historyById.get(id) ?? []).slice().reverse();

  // Per-share payouts restated in today's shares, for the safety score only.
  //
  // A provider reports each payout as it was announced, so a pre-split $0.82 sits in the same
  // series as a post-split $0.24. Left alone a 4-for-1 split reads as a 75% dividend cut — exactly
  // the signal the safety score exists to detect — and it would confidently mark a healthy payer
  // as at-risk. The "Announced payouts" table below deliberately keeps the raw figures: it says
  // what these companies declared, and that is what was declared.
  const splitsById = await loadSplitsByInstrument(supabase, ids);
  const safetyHistory = (id: string) => {
    const splits = splitsById.get(id);
    const hist = historyAsc(id);
    if (!splits?.length) return hist;
    return hist.map((h) => ({ ...h, amount: adjustDividendPerShare(h.amount, splits, h.exDate) }));
  };

  // Fill in the missing next-payout dates ourselves.
  //
  // The provider declares a next ex-date for only a minority of tickers — for most of a real
  // portfolio it returns nothing, which left those holdings off the calendar entirely and made
  // projected income look a fraction of the annual figure printed right beside it. A holding that
  // has paid every March, June, September and December for six years is not a mystery, so we
  // project its next date from its own history and mark it as inferred. estimateNextExDate refuses
  // to guess where the history can't support it (too few payments, or a payer that has missed two
  // cycles and may have stopped), so those stay off the calendar and stay disclosed as untimed.
  const calendarRows: CalendarPosition[] = rows.map((p) => {
    if (p.next_dividend_date && p.next_dividend_date >= today) return p;
    const history = historyAsc(p.instrument_id);
    const estimate = estimateNextExDate(history, today);
    if (!estimate) return p;
    return {
      ...p,
      next_dividend_date: estimate,
      div_frequency: p.div_frequency ?? inferDivFrequency(history),
      next_date_estimated: true,
    };
  });
  const estimatedDates = new Map(
    calendarRows
      .filter((p) => p.next_date_estimated)
      .map((p) => [p.instrument_id, p.next_dividend_date as string])
  );

  // Upcoming payouts: the next dividend from each holding, declared or inferred.
  const upcoming = calendarRows
    .filter((p) => p.next_dividend_date && p.next_dividend_date >= today && p.shares > 0)
    .map((p) => {
      const perShare =
        p.next_dividend_per_share ??
        (p.annual_div_per_share && p.div_frequency ? p.annual_div_per_share / p.div_frequency : null);
      return {
        p,
        perShare,
        amount: perShare != null ? perShare * p.shares : null,
        date: p.next_dividend_date as string,
        estimated: estimatedDates.has(p.instrument_id),
      };
    })
    .sort((a, b) => a.date.localeCompare(b.date));

  // Forward 12-month dividend calendar — projected income rolled up by month (base currency).
  const calendar = buildDividendCalendar(calendarRows, fx, today);
  const calendarChart = calendar.months.map((m) => ({
    label: m.label,
    short: m.label.slice(0, 3),
    total: m.total,
    count: m.events.length,
    note: undefined as string | undefined,
  }));
  const peakMonth = calendar.months.reduce(
    (best, m) => (m.total > best.total ? m : best),
    calendar.months[0]
  );

  // The calendar is forward-looking, so late in the month its first bar is empty: everything due
  // has already been paid. An empty leading bar reads as "you get nothing in August" when the truth
  // is the opposite, and it happens every month-end. Fill it with what was actually received and
  // say so on the bar, so the twelve months read as one continuous income picture.
  const paidThisMonth = receivedMonthly[receivedMonthly.length - 1]?.total ?? 0;
  const currentMonthAlreadyPaid = calendarChart[0] && calendarChart[0].total === 0 && paidThisMonth > 0;
  if (currentMonthAlreadyPaid) {
    calendarChart[0].total = paidThisMonth;
    calendarChart[0].note = "Already paid this month";
  }

  // Dividend safety per dividend-paying holding, sorted by score (unrated last).
  const safetyRows = rows
    .filter((p) => (p.annual_div_per_share ?? 0) > 0)
    .map((p) => ({
      p,
      safety: dividendSafety(safetyHistory(p.instrument_id), p.div_yield_current),
    }))
    .sort((a, b) => (b.safety.score ?? -1) - (a.safety.score ?? -1));
  const safetyById = new Map<string, DividendSafety>(
    safetyRows.map(({ p, safety }) => [p.instrument_id, safety])
  );

  return (
    <main className="min-h-screen bg-slate-50 text-slate-800">
      <DashboardNav active="dividends" />

      <div className="mx-auto max-w-6xl px-6 py-8">
        {/* Forecast summary */}
        <div className="mb-2 flex justify-end">
          <PricesAsOf asOf={oldestPriceAsOf(rows)} />
        </div>
        <div className="mb-4">
          <h1 className="font-display text-3xl font-medium tracking-tight text-slate-900">Your dividend income</h1>
          <p className="mt-1 text-sm text-slate-500">What your holdings pay you, what&apos;s coming up, and how dependable it looks.</p>
        </div>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
          <Card
            label="Income / year"
            hint="Estimated dividend income over the next year at current payout rates."
            value={money(annualIncome, base)}
          />
          <Card
            label="Yield"
            hint="Your dividend income as a percentage of what your holdings are worth today."
            value={pct(yieldOnValue)}
          />
          <Card
            label="Per month (avg)"
            hint="Your yearly dividend income spread evenly across 12 months."
            value={money(annualIncome / 12, base)}
          />
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
            What you can expect to collect each month, projected from when each holding usually pays and
            how often.
            {currentMonthAlreadyPaid &&
              " This month's payments have already been made, so its bar shows what you received rather than what's still due."}
            {calendar.estimatedCount > 0 &&
              ` ${calendar.estimatedCount} of these payer${calendar.estimatedCount === 1 ? " has" : "s have"} no declared next date, so ${calendar.estimatedCount === 1 ? "its" : "their"} timing (${money(calendar.estimatedTotal, base)} of the total) is worked out from ${calendar.estimatedCount === 1 ? "its" : "their"} own payment history and marked “est.” below.`}
            {calendar.untimedCount > 0 &&
              ` ${calendar.untimedCount} payer${calendar.untimedCount === 1 ? "" : "s"} whose history can't support even an estimate ${calendar.untimedCount === 1 ? "is" : "are"} left out.`}
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
                              {e.estimated && (
                                <span
                                  className="text-slate-300"
                                  title="No declared date — timing estimated from this holding's own payment history."
                                >
                                  {" "}est.
                                </span>
                              )}
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
            <h2 className="font-semibold">Coming up</h2>
            <p className="mb-4 text-xs text-slate-400">
              The next dividend from each holding, with your estimated payout. Dates marked{" "}
              <span className="text-slate-500">est.</span> were worked out from the holding&apos;s own
              payment history because nobody has declared one yet.
            </p>
            {upcoming.length === 0 ? (
              <p className="py-8 text-center text-sm text-slate-400">
                No upcoming ex-dividend dates yet. Add holdings and hit “Refresh prices”.
              </p>
            ) : (
              <ul className="divide-y divide-slate-100 text-sm">
                {upcoming.map(({ p, amount, date, estimated }) => (
                  <li key={p.instrument_id} className="flex items-center justify-between py-2.5">
                    <div>
                      <div className="font-medium">{p.symbol}</div>
                      <div className="text-xs text-slate-400">
                        {date}
                        {estimated && (
                          <span
                            className="text-slate-300"
                            title="No declared date — estimated from this holding's own payment history."
                          >
                            {" "}est.
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="text-right">
                      {amount != null ? money(amount, p.currency) : <span className="text-slate-300">-</span>}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Per-holding forecast */}
          <section className="rounded-2xl border border-slate-200 bg-white p-5">
            <h2 className="font-semibold">Income by holding</h2>
            <p className="mb-4 text-xs text-slate-400">How much each stock is expected to pay you over a year.</p>
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
            <span className="text-xs text-slate-400">0 to 100 · higher is steadier</span>
          </div>
          <p className="mb-4 max-w-2xl text-xs text-slate-400">
            A calm read on how dependable each payout looks, from its own history: past cuts,
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

        {/* What actually landed, over two years */}
        <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-5">
          <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="font-semibold">Income received</h2>
            <span className="text-sm text-slate-500">
              {money(received24, base)} over 24 months
            </span>
          </div>
          <p className="mb-4 max-w-2xl text-xs text-slate-400">
            Dividend payments actually paid into your account, month by month, from your own
            transactions — not an estimate, and no option premium. Months with no payout are shown
            as gaps rather than skipped.
          </p>
          {received24 > 0 ? (
            <DividendCalendarChart data={receivedChart} currency={base} valueLabel="Received" highlight="last" />
          ) : (
            <p className="py-10 text-center text-sm text-slate-400">
              No dividend payments recorded yet. They appear here once you import or add them.
            </p>
          )}
        </section>

        {/* Year by year, past and projected */}
        <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-5">
          <h2 className="font-semibold">Income by year</h2>
          <p className="mb-4 max-w-2xl text-xs text-slate-400">
            <strong className="font-medium text-slate-500">Dividend payouts only.</strong> Option
            premium is never counted here — it lives on the Options page, and mixing the two would
            make this number impossible to check against a broker statement. Future years assume you
            hold what you hold today and each company keeps paying its current rate. Nothing is
            grown — a rising payout would be a guess compounded into a number you might plan around.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase text-slate-400">
                <tr>
                  <th className="pb-2">Year</th>
                  <th className="pb-2">Basis</th>
                  <th className="pb-2 text-right">Income</th>
                </tr>
              </thead>
              <tbody>
                {byYear.map((y) => (
                  <tr key={y.year} className="border-t border-slate-100">
                    <td className="py-2.5 font-medium text-slate-900">{y.year}</td>
                    <td className="py-2.5">
                      <span
                        className={
                          y.basis === "actual"
                            ? "rounded-full bg-emerald-50 px-2 py-0.5 text-xs text-emerald-700"
                            : y.basis === "partial"
                              ? "rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600"
                              : "rounded-full bg-amber-50 px-2 py-0.5 text-xs text-amber-700"
                        }
                        title={
                          y.basis === "actual"
                            ? "Paid and recorded."
                            : y.basis === "partial"
                              ? "Received so far this year, plus the rest of the year at today's rate."
                              : "Estimate: today's holdings at today's payout rates."
                        }
                      >
                        {y.basis === "actual" ? "Received" : y.basis === "partial" ? "So far + rest of year" : "Estimate"}
                      </span>
                    </td>
                    <td className={`py-2.5 text-right tabular-nums ${y.basis === "estimate" ? "text-slate-500" : "font-medium"}`}>
                      {money(y.total, base)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* Recent payments */}
        <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-5">
          <h2 className="mb-4 font-semibold">Recent payments</h2>
          {paidRecently.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-400">
              No dividend payments recorded yet.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase text-slate-400">
                  <tr>
                    <th className="pb-2">Paid</th>
                    <th className="pb-2">Stock</th>
                    <th className="pb-2 text-right">Per share</th>
                    <th className="pb-2 text-right">You received</th>
                  </tr>
                </thead>
                <tbody>
                  {paidRecently.map((r, i) => (
                    <tr key={i} className="border-t border-slate-100">
                      <td className="py-2.5">{r.date}</td>
                      <td className="py-2.5 font-medium">{r.symbol}</td>
                      <td className="py-2.5 text-right">
                        {r.perShare != null ? money(r.perShare, r.currency) : <span className="text-slate-300" title="Your broker reported the total paid, not a per-share rate.">—</span>}
                      </td>
                      <td className="py-2.5 text-right">{money(r.total, r.currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Announced payouts for the stocks you hold — reference data, not your income */}
        <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-5">
          <h2 className="mb-1 font-semibold">Announced payouts</h2>
          <p className="mb-4 max-w-2xl text-xs text-slate-400">
            What these companies declared per share, from the synced dividend history. &ldquo;At your
            shares&rdquo; applies your <em>current</em> holding, so it is a what-if for older rows,
            not what you were paid — see Recent payments above for that.
          </p>
          {recent.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-400">
              No dividend history synced yet. It populates when you add holdings or refresh prices.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase text-slate-400">
                  <tr>
                    <th className="pb-2" title="Ex-dividend date: you had to own the stock before this day to receive the payout.">Ex-date</th>
                    <th className="pb-2">Stock</th>
                    <th className="pb-2 text-right" title="The dividend paid for each share.">Per share</th>
                    <th className="pb-2 text-right" title="Per-share amount × the shares you hold TODAY — a what-if, not what you were paid.">At your shares</th>
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

function Card({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="flex items-center gap-1 text-xs uppercase tracking-wide text-slate-400">
        {label}
        {hint && <span title={hint} aria-label={hint} className="cursor-help text-slate-300">ⓘ</span>}
      </div>
      <div className="mt-1 text-xl font-semibold">{value}</div>
    </div>
  );
}
