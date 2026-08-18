import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { ensurePortfolio, refreshPrices, signOut } from "./actions";
import { getRates } from "@/lib/marketdata";
import { money, pct, num, timeAgo } from "@/lib/format";
import AddHoldingForm from "@/components/AddHoldingForm";
import AllocationChart from "@/components/AllocationChart";
import ImportTransactionsForm from "@/components/ImportTransactionsForm";

export const dynamic = "force-dynamic";

type Position = {
  instrument_id: string;
  symbol: string;
  exchange: string;
  name: string | null;
  type: string | null;
  currency: string;
  sector: string | null;
  shares: number;
  avg_cost: number;
  last_price: number | null;
  day_change_pct: number | null;
  year_total_divs: number | null;
  div_yield_current: number | null;
  price_as_of: string | null;
  div_paid: number | null;
  country_iso: string | null;
};

export default async function Dashboard() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const portfolio = await ensurePortfolio();

  // Consolidate across ALL of the user's portfolios (default + broker-synced).
  // RLS on the positions view scopes this to the signed-in user automatically.
  const { data: positions } = await supabase
    .from("positions")
    .select("*")
    .order("symbol");

  const rows = (positions ?? []) as Position[];

  // Convert every position into the portfolio's base currency before summing,
  // so mixed US + Asian holdings total correctly. Rates fall back to 1 with no FX data.
  const base = portfolio.base_currency || "USD";
  const rates = await getRates(rows.map((p) => p.currency), base);
  const fx = (ccy: string) => rates[ccy] ?? 1;

  let marketValue = 0, costBasis = 0, dayPL = 0, annualDivs = 0, dividendsReceived = 0;
  for (const p of rows) {
    const r = fx(p.currency);
    marketValue += (p.last_price ?? 0) * p.shares * r;
    costBasis += p.avg_cost * p.shares * r;
    annualDivs += (p.year_total_divs ?? 0) * r;
    dividendsReceived += (p.div_paid ?? 0) * r;
    if (p.day_change_pct != null && p.last_price != null) {
      const prev = p.last_price / (1 + p.day_change_pct / 100);
      dayPL += (p.last_price - prev) * p.shares * r;
    }
  }
  const yieldOnValue = marketValue > 0 ? (annualDivs / marketValue) * 100 : 0;
  const totalPL = marketValue - costBasis;
  const totalPLpct = costBasis > 0 ? (totalPL / costBasis) * 100 : 0;
  // Total return = capital gains + dividends actually received (the honest "how am I doing" number).
  const totalReturn = totalPL + dividendsReceived;
  const totalReturnPct = costBasis > 0 ? (totalReturn / costBasis) * 100 : 0;

  const alloc = rows
    .map((p) => ({ name: p.symbol, value: (p.last_price ?? 0) * p.shares * fx(p.currency) }))
    .filter((a) => a.value > 0);

  // Diversification: group market value (base currency) by sector and by region.
  const bySector = new Map<string, number>();
  const byRegion = new Map<string, number>();
  for (const p of rows) {
    const v = (p.last_price ?? 0) * p.shares * fx(p.currency);
    if (v <= 0) continue;
    const sectorKey =
      p.sector || (p.type === "etf" || p.type === "fund" ? "Funds & ETFs" : "Unclassified");
    bySector.set(sectorKey, (bySector.get(sectorKey) ?? 0) + v);
    const c = (p.country_iso || "").toLowerCase();
    const regionKey = !c
      ? "Unclassified"
      : c.includes("united states") || c === "us" || c === "usa"
        ? "United States"
        : "International";
    byRegion.set(regionKey, (byRegion.get(regionKey) ?? 0) + v);
  }
  const toAlloc = (m: Map<string, number>) =>
    [...m.entries()]
      .map(([name, value]) => ({ name, value, pct: marketValue > 0 ? (value / marketValue) * 100 : 0 }))
      .sort((a, b) => b.value - a.value);
  const sectorAlloc = toAlloc(bySector);
  const regionAlloc = toAlloc(byRegion);
  const intlPct = marketValue > 0 ? ((byRegion.get("International") ?? 0) / marketValue) * 100 : 0;

  // "Prices as of…" — honest freshness = the OLDEST price timestamp among priced holdings,
  // so the label guarantees every price shown is at least that current.
  const asOfTimes = rows
    .filter((p) => p.last_price != null && p.price_as_of)
    .map((p) => new Date(p.price_as_of as string).getTime())
    .filter((t) => !isNaN(t));
  const pricesAsOf = asOfTimes.length ? new Date(Math.min(...asOfTimes)).toISOString() : null;

  return (
    <main className="min-h-screen bg-slate-50 text-slate-800">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-2">
            <div className="h-7 w-7 rounded-full bg-gradient-to-br from-sky-400 to-indigo-500" />
            <span className="text-lg font-semibold">Snowfolio</span>
          </div>
          <div className="flex items-center gap-4 text-sm">
            <Link href="/dashboard/dividends" className="font-medium text-indigo-600 hover:underline">
              Dividends
            </Link>
            <Link href="/dashboard/broker" className="font-medium text-indigo-600 hover:underline">
              Brokers
            </Link>
            <span className="text-slate-500">{user?.email}</span>
            <form action={signOut}>
              <button className="rounded-lg border border-slate-300 px-3 py-1.5 hover:bg-slate-50">
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-6 py-8">
        {/* Summary cards */}
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
          <Card label={`Market value (${base})`} value={money(marketValue, base)} />
          <Card label="Total cost" value={money(costBasis, base)} />
          <Card
            label="Total P/L"
            value={money(totalPL, base)}
            sub={pct(totalPLpct)}
            positive={totalPL >= 0}
          />
          <Card
            label="Total return"
            value={money(totalReturn, base)}
            sub={`${pct(totalReturnPct)} incl. dividends`}
            positive={totalReturn >= 0}
          />
          <Card label="Day P/L" value={money(dayPL, base)} positive={dayPL >= 0} />
          <Card
            label="Est. annual dividends"
            value={money(annualDivs, base)}
            sub={`${pct(yieldOnValue)} yield`}
            positive
          />
        </div>

        <div className="mt-8 grid gap-6 lg:grid-cols-3">
          {/* Holdings table */}
          <section className="lg:col-span-2 rounded-2xl border border-slate-200 bg-white p-5">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 className="font-semibold">Holdings</h2>
                {pricesAsOf && (
                  <p className="text-xs text-slate-400">Prices as of {timeAgo(pricesAsOf)}</p>
                )}
              </div>
              <form action={refreshPrices}>
                <button className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50">
                  Refresh prices
                </button>
              </form>
            </div>

            {rows.length === 0 ? (
              <p className="py-10 text-center text-sm text-slate-400">
                No holdings yet. Add your first one on the right →
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-xs uppercase text-slate-400">
                    <tr>
                      <th className="pb-2">Symbol</th>
                      <th className="pb-2 text-right">Shares</th>
                      <th className="pb-2 text-right">Avg cost</th>
                      <th className="pb-2 text-right">Price</th>
                      <th className="pb-2 text-right">Value</th>
                      <th className="pb-2 text-right">Yield</th>
                      <th className="pb-2 text-right">P/L</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((p) => {
                      const mv = (p.last_price ?? 0) * p.shares;
                      const pl = mv - p.avg_cost * p.shares;
                      return (
                        <tr key={p.instrument_id} className="border-t border-slate-100">
                          <td className="py-2.5">
                            <div className="font-medium">{p.symbol}</div>
                            <div className="text-xs text-slate-400">
                              {p.exchange} · {p.name}
                            </div>
                          </td>
                          <td className="py-2.5 text-right">{num(p.shares, 4)}</td>
                          <td className="py-2.5 text-right">{money(p.avg_cost, p.currency)}</td>
                          <td
                            className="py-2.5 text-right"
                            title={p.price_as_of ? `as of ${timeAgo(p.price_as_of)}` : undefined}
                          >
                            {p.last_price == null ? (
                              <span className="text-slate-300">—</span>
                            ) : (
                              money(p.last_price, p.currency)
                            )}
                          </td>
                          <td className="py-2.5 text-right">{money(mv, p.currency)}</td>
                          <td className="py-2.5 text-right text-slate-500">
                            {p.div_yield_current != null ? pct(p.div_yield_current) : "—"}
                          </td>
                          <td
                            className={`py-2.5 text-right ${pl >= 0 ? "text-emerald-600" : "text-rose-600"}`}
                          >
                            {money(pl, p.currency)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* Right column: allocation + add form */}
          <section className="space-y-6">
            <div className="rounded-2xl border border-slate-200 bg-white p-5">
              <h2 className="mb-3 font-semibold">Allocation</h2>
              {alloc.length ? (
                <AllocationChart data={alloc} currency={base} />
              ) : (
                <p className="py-6 text-center text-sm text-slate-400">Add holdings to see allocation.</p>
              )}
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-5">
              <h2 className="mb-3 font-semibold">Add holding</h2>
              <AddHoldingForm />
              <p className="mt-3 text-xs text-slate-400">
                Symbol + exchange, e.g. AAPL / US, 0700 / HK, 7203 / TSE.
              </p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-5">
              <h2 className="mb-3 font-semibold">Import CSV</h2>
              <ImportTransactionsForm />
            </div>
          </section>
        </div>

        {rows.length > 0 && (
          <div className="mt-6 grid gap-6 lg:grid-cols-2">
            <section className="rounded-2xl border border-slate-200 bg-white p-5">
              <h2 className="mb-4 font-semibold">By sector</h2>
              <AllocBars items={sectorAlloc} base={base} />
            </section>
            <section className="rounded-2xl border border-slate-200 bg-white p-5">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="font-semibold">By region</h2>
                <span className="text-xs text-slate-400">International {intlPct.toFixed(1)}%</span>
              </div>
              <AllocBars items={regionAlloc} base={base} />
            </section>
          </div>
        )}
      </div>
    </main>
  );
}

function AllocBars({
  items,
  base,
}: {
  items: { name: string; value: number; pct: number }[];
  base: string;
}) {
  const colors = [
    "bg-indigo-500", "bg-sky-500", "bg-emerald-500", "bg-amber-500", "bg-rose-500",
    "bg-violet-500", "bg-teal-500", "bg-fuchsia-500", "bg-cyan-500", "bg-lime-500",
  ];
  if (items.length === 0) {
    return <p className="py-6 text-center text-sm text-slate-400">No data yet.</p>;
  }
  return (
    <ul className="space-y-2.5 text-sm">
      {items.slice(0, 10).map((it, i) => (
        <li key={it.name}>
          <div className="mb-1 flex items-center justify-between gap-2">
            <span className="truncate font-medium text-slate-700">{it.name}</span>
            <span className="shrink-0 text-slate-500">
              {it.pct.toFixed(1)}% · {money(it.value, base)}
            </span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
            <div
              className={`h-full rounded-full ${colors[i % colors.length]}`}
              style={{ width: `${Math.max(it.pct, 0.5)}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

function Card({
  label, value, sub, positive,
}: { label: string; value: string; sub?: string; positive?: boolean }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="text-xs uppercase tracking-wide text-slate-400">{label}</div>
      <div className="mt-1 text-xl font-semibold">{value}</div>
      {sub && (
        <div className={`text-sm ${positive ? "text-emerald-600" : "text-rose-600"}`}>{sub}</div>
      )}
    </div>
  );
}
