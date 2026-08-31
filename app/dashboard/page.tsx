import { Fragment } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/supabase/user";
import { ensurePortfolio, refreshPrices } from "./actions";
import DashboardNav from "@/components/DashboardNav";
import { getCachedRates } from "@/lib/fx";
import { isBrokerSyncOwner } from "@/lib/brokersync";
import { money, pct, num, timeAgo } from "@/lib/format";
import AddHoldingForm from "@/components/AddHoldingForm";
import { AllocationChart } from "@/components/charts";
import ImportTransactionsForm from "@/components/ImportTransactionsForm";
import SubmitButton from "@/components/SubmitButton";
import FirstRun from "@/components/FirstRun";
import { CHART_CATEGORICAL } from "@/lib/chartColors";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // "Refresh prices" enriches many holdings; give it room.

type Position = {
  portfolio_id: string;
  instrument_id: string;
  symbol: string;
  exchange: string;
  name: string | null;
  type: string | null;
  currency: string;
  sector: string | null;
  sector_weights: { sector: string; weight: number }[] | null;
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

export default async function Dashboard({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const sp = await searchParams;
  const view = sp.holdings === "accounts" ? "accounts" : "consolidated";
  const supabase = await createClient();
  const user = await getCurrentUser();
  const portfolio = await ensurePortfolio();
  const canBrokerSync = isBrokerSyncOwner(user?.email); // per-user brokerage connect isn't available yet

  // The four reads below are independent — fetch them together instead of serially (this is the
  // most-visited page; each awaited round trip adds latency). RLS scopes every one to the user.
  const [{ data: positions }, { data: optRows }, { data: pfList }, { data: brokerAccts }] =
    await Promise.all([
      // Consolidate across ALL of the user's portfolios (default + broker-synced).
      supabase.from("positions").select("*").order("symbol"),
      // Net option premium across every leg (including options on underlyings not currently held),
      // for the income picture. This is the ONLY place premium enters the totals now — it is no
      // longer folded into equity cost basis, so it is counted exactly once.
      supabase.from("option_positions").select("premium_net, currency"),
      // Portfolio names, for grouping holdings by account.
      supabase.from("portfolios").select("id, name"),
      // Uninvested cash sitting in each connected brokerage account (from the broker sync).
      supabase.from("broker_accounts").select("portfolio_id, cash_balance, currency"),
    ]);
  const rows = (positions ?? []) as Position[];
  const pfName = new Map<string, string>(
    (pfList ?? []).map((p: { id: string; name: string }) => [p.id, p.name] as [string, string])
  );

  // Convert every position into the base currency before summing (mixed US + intl total correctly).
  const base = portfolio.base_currency || "USD";
  const optionCurrencies = (optRows ?? []).map((o: { currency: string | null }) => o.currency ?? base);
  const rates = await getCachedRates(supabase, [...rows.map((p) => p.currency), ...optionCurrencies], base);
  const fx = (ccy: string) => rates[ccy] ?? 1;

  let marketValue = 0, costBasis = 0, dayPL = 0, annualDivs = 0, dividendsReceived = 0;
  let unpricedCount = 0; // holdings with no quote yet — excluded from value/cost so P/L isn't distorted
  const mvByPortfolio = new Map<string, number>(); // holdings market value per account, in base currency
  for (const p of rows) {
    const r = fx(p.currency);
    // Dividends are real regardless of whether we have a live price, so they always count.
    annualDivs += (p.year_total_divs ?? 0) * r;
    dividendsReceived += (p.div_paid ?? 0) * r;
    // No quote yet (obscure/intl ticker, or a fetch that hasn't landed): counting its full cost
    // basis against a $0 market value would show the holding as a fabricated ~100% loss. Exclude it
    // from BOTH sides of the capital P/L until a price arrives; the row itself still shows "—".
    if (p.last_price == null) { unpricedCount++; continue; }
    const v = p.last_price * p.shares * r;
    marketValue += v;
    mvByPortfolio.set(p.portfolio_id, (mvByPortfolio.get(p.portfolio_id) ?? 0) + v);
    costBasis += p.avg_cost * p.shares * r;
    if (p.day_change_pct != null && 1 + p.day_change_pct / 100 > 0) {
      const prev = p.last_price / (1 + p.day_change_pct / 100);
      dayPL += (p.last_price - prev) * p.shares * r;
    }
  }
  let optionPremium = 0;
  for (const o of (optRows ?? []) as { premium_net: number | null; currency: string | null }[]) {
    optionPremium += (o.premium_net ?? 0) * fx(o.currency ?? base);
  }

  // Free cash per account, in base currency. IMPORTANT: SnapTrade's balance.total is the account's
  // TOTAL value (holdings + cash), NOT free cash — so free cash = total − holdings market value.
  // Adding the raw total on top of holdings would count every account almost twice (a $269k E*TRADE
  // would read $552k). Deriving cash this way makes holdings + cash equal the broker's own total, and
  // is self-correcting: even if a price or FX is momentarily off, the holdings term cancels out.
  const cashByPortfolio = new Map<string, number>();
  let totalCash = 0;
  for (const b of (brokerAccts ?? []) as { portfolio_id: string | null; cash_balance: number | null; currency: string | null }[]) {
    if (!b.portfolio_id || b.cash_balance == null) continue;
    const total = b.cash_balance * fx(b.currency ?? base);
    const cash = total - (mvByPortfolio.get(b.portfolio_id) ?? 0);
    cashByPortfolio.set(b.portfolio_id, (cashByPortfolio.get(b.portfolio_id) ?? 0) + cash);
    totalCash += cash;
  }
  const totalValue = marketValue + totalCash; // holdings + free cash = the broker's own account total
  const yieldOnValue = marketValue > 0 ? (annualDivs / marketValue) * 100 : 0;
  const totalPL = marketValue - costBasis; // pure share appreciation (premium NOT baked in)
  const totalPLpct = costBasis > 0 ? (totalPL / costBasis) * 100 : 0;
  // Total return = capital gains + dividends received + option premium — each counted once.
  const totalReturn = totalPL + dividendsReceived + optionPremium;
  const totalReturnPct = costBasis > 0 ? (totalReturn / costBasis) * 100 : 0;

  // Group holdings by portfolio (account), with per-account subtotals.
  const groupsMap = new Map<string, Position[]>();
  for (const p of rows) {
    const arr = groupsMap.get(p.portfolio_id) ?? [];
    arr.push(p);
    groupsMap.set(p.portfolio_id, arr);
  }
  const groups = [...groupsMap.entries()]
    .map(([pid, prows]) => {
      let mv = 0, pl = 0;
      for (const p of prows) {
        if (p.last_price == null) continue; // unpriced: don't fold a phantom loss into the account subtotal
        const r = fx(p.currency);
        const v = p.last_price * p.shares * r;
        mv += v;
        pl += v - p.avg_cost * p.shares * r;
      }
      const cash = cashByPortfolio.get(pid) ?? 0;
      return { pid, name: pfName.get(pid) ?? "Portfolio", rows: prows, mv, pl, cash };
    })
    .sort((a, b) => b.mv + b.cash - (a.mv + a.cash));
  const showGroups = groups.length > 1;

  // Roll the same instrument up across accounts into one line (the "no duplicates" view).
  // Price/currency/sector are identical per instrument; only shares & avg cost differ by account.
  type Consolidated = {
    instrument_id: string; symbol: string; exchange: string; name: string | null;
    type: string | null; sector: string | null; sector_weights: Position["sector_weights"]; currency: string;
    shares: number; costSum: number; last_price: number | null; day_change_pct: number | null;
    div_yield_current: number | null; price_as_of: string | null; accounts: Set<string>;
  };
  const consMap = new Map<string, Consolidated>();
  for (const p of rows) {
    let e = consMap.get(p.instrument_id);
    if (!e) {
      e = {
        instrument_id: p.instrument_id, symbol: p.symbol, exchange: p.exchange, name: p.name,
        type: p.type, sector: p.sector, sector_weights: p.sector_weights, currency: p.currency,
        shares: 0, costSum: 0, last_price: p.last_price, day_change_pct: p.day_change_pct,
        div_yield_current: p.div_yield_current, price_as_of: p.price_as_of, accounts: new Set(),
      };
      consMap.set(p.instrument_id, e);
    }
    e.shares += p.shares;
    e.costSum += p.avg_cost * p.shares;
    e.accounts.add(pfName.get(p.portfolio_id) ?? "Portfolio");
  }
  const consolidated = [...consMap.values()]
    .map((e) => ({ ...e, avg_cost: e.shares !== 0 ? e.costSum / e.shares : 0 }))
    .sort((a, b) => (b.last_price ?? 0) * b.shares - (a.last_price ?? 0) * a.shares);

  const alloc = rows
    .map((p) => ({ name: p.symbol, value: (p.last_price ?? 0) * p.shares * fx(p.currency) }))
    .filter((a) => a.value > 0);

  // Diversification: group market value (base currency) by sector and by region.
  const bySector = new Map<string, number>();
  const byRegion = new Map<string, number>();
  for (const p of rows) {
    const v = (p.last_price ?? 0) * p.shares * fx(p.currency);
    if (v <= 0) continue;
    // Crypto is its own bucket; ETFs/funds distribute across their look-through sector weights;
    // individual stocks land in their single sector; anything still unclassified → "Funds & ETFs".
    if (p.type === "crypto") {
      bySector.set("Crypto", (bySector.get("Crypto") ?? 0) + v);
    } else if (p.sector_weights && p.sector_weights.length) {
      let assigned = 0;
      for (const w of p.sector_weights) {
        bySector.set(w.sector, (bySector.get(w.sector) ?? 0) + v * w.weight);
        assigned += v * w.weight;
      }
      const leftover = v - assigned;
      if (leftover > 0.01) bySector.set("Other", (bySector.get("Other") ?? 0) + leftover);
    } else {
      const sectorKey = p.sector || "Funds & ETFs";
      bySector.set(sectorKey, (bySector.get(sectorKey) ?? 0) + v);
    }
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

  // A brand-new account has no holdings yet: show a warm, guided first-run instead of empty $0 tiles.
  const isFirstRun = rows.length === 0;

  const asOfTimes = rows
    .filter((p) => p.last_price != null && p.price_as_of)
    .map((p) => new Date(p.price_as_of as string).getTime())
    .filter((t) => !isNaN(t));
  const pricesAsOf = asOfTimes.length ? new Date(Math.min(...asOfTimes)).toISOString() : null;

  return (
    <main className="min-h-screen bg-gradient-to-b from-slate-50 to-slate-100 text-slate-800">
      <DashboardNav active="overview" email={user?.email} />

      <div className="mx-auto max-w-6xl px-6 py-8">
        {/* Page intro */}
        <div className="mb-5">
          <h1 className="font-display text-3xl font-medium tracking-tight text-slate-900">Your portfolio</h1>
          <p className="mt-1.5 text-sm text-slate-500">Everything you own, and what it&apos;s earned you.</p>
        </div>

        {isFirstRun ? (
          <FirstRun canBrokerSync={canBrokerSync} />
        ) : (
        <>
        {/* Summary tiles */}
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
          <Tile
            label="Worth now"
            hint="Your holdings plus uninvested cash in your connected accounts, in your base currency."
            value={money(totalValue, base)}
            sub={totalCash > 0 ? `incl. ${money(totalCash, base)} cash` : undefined}
            neutral
            accent
          />
          <Tile
            label="Total earned"
            hint="Everything you've made: price gains, dividends, and option premium, counted once each."
            value={money(totalReturn, base)}
            sub={optionPremium !== 0 ? "gains + dividends + premium" : `${pct(totalReturnPct)} incl. dividends`}
            positive={totalReturn >= 0}
          />
          <Tile
            label="Gain / loss"
            hint="How much your shares are up or down versus what you paid — price only, before dividends."
            value={money(totalPL, base)}
            sub={`${pct(totalPLpct)} on shares`}
            positive={totalPL >= 0}
          />
          <Tile label="Today" hint="How much your holdings moved so far today." value={money(dayPL, base)} positive={dayPL >= 0} />
          <Tile
            label="Dividends / yr"
            hint="Estimated dividend income over the next year at current rates."
            value={money(annualDivs, base)}
            sub={`${pct(yieldOnValue)} yield`}
            neutral
          />
          <Tile label="Invested" hint="What you paid for everything you currently hold." value={money(costBasis, base)} muted />
        </div>

        {unpricedCount > 0 && (
          <p className="mt-3 text-xs text-slate-500">
            {unpricedCount} holding{unpricedCount === 1 ? "" : "s"} {unpricedCount === 1 ? "doesn't" : "don't"} have a
            price yet, so {unpricedCount === 1 ? "it isn't" : "they aren't"} counted in the value or gain/loss above.
            {" "}Free cash is worked out as your broker&apos;s account total minus the holdings we can
            price, so {unpricedCount === 1 ? "that holding's" : "those holdings'"} value is sitting in
            the cash figure for now — your total is still right, the split between cash and holdings
            isn&apos;t. Prices usually arrive within a day.
          </p>
        )}

        <div className="mt-8 grid gap-6 lg:grid-cols-3">
          {/* Holdings */}
          <section className="lg:col-span-2 rounded-2xl border border-slate-200 bg-white p-5 shadow-soft">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 className="text-base font-semibold">Holdings</h2>
                {pricesAsOf && <p className="text-xs text-slate-400">Prices as of {timeAgo(pricesAsOf)}</p>}
              </div>
              <div className="flex items-center gap-2">
                {showGroups && (
                  <div className="flex items-center gap-0.5 rounded-lg border border-slate-200 p-0.5 text-xs">
                    <Link href="/dashboard" className={`rounded-md px-2 py-1 ${view === "consolidated" ? "bg-slate-900 text-white" : "text-slate-500 hover:bg-slate-100"}`}>
                      Consolidated
                    </Link>
                    <Link href="/dashboard?holdings=accounts" className={`rounded-md px-2 py-1 ${view === "accounts" ? "bg-slate-900 text-white" : "text-slate-500 hover:bg-slate-100"}`}>
                      By account
                    </Link>
                  </div>
                )}
                <form action={refreshPrices}>
                  <SubmitButton
                    pendingText="Refreshing…"
                    className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium hover:bg-slate-50"
                  >
                    Refresh prices
                  </SubmitButton>
                </form>
              </div>
            </div>

            {rows.length === 0 ? (
              <p className="py-10 text-center text-sm text-slate-400">
                No holdings yet. Add one on the right{canBrokerSync ? ", import a CSV, or connect a brokerage" : " or import a CSV"} →
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-[11px] uppercase tracking-wide text-slate-400">
                    <tr>
                      <th className="pb-2 pr-2">Holding</th>
                      <th className="px-2 pb-2 text-right">Shares</th>
                      <th className="px-2 pb-2 text-right" title="The average price you paid per share.">Paid / sh</th>
                      <th className="px-2 pb-2 text-right" title="The latest market price per share.">Price</th>
                      <th className="px-2 pb-2 text-right" title="How much the price moved so far today.">Today</th>
                      <th className="px-2 pb-2 text-right" title="What this holding is worth now (shares × price).">Value</th>
                      <th className="px-2 pb-2 text-right" title="Dividend yield: annual dividend as a % of today's price.">Yield</th>
                      <th className="px-2 pb-2 text-right" title="Gain or loss: what it's worth now minus what you paid.">Gain / loss</th>
                    </tr>
                  </thead>
                  <tbody>
                    {view === "accounts" && showGroups ? groups.map((g) => (
                      <Fragment key={g.pid}>
                        {showGroups && (
                          <tr className="border-t border-slate-200 bg-slate-50">
                            <td colSpan={8} className="px-1 py-2">
                              <div className="flex items-center justify-between">
                                <span className="font-semibold text-slate-700">
                                  {g.name}
                                  <span className="ml-2 text-xs font-normal text-slate-400">
                                    {g.rows.length} holding{g.rows.length === 1 ? "" : "s"}
                                    {g.cash > 0 ? ` · ${money(g.cash, base)} cash` : ""}
                                  </span>
                                </span>
                                <span className="text-sm">
                                  <span className="font-semibold">{money(g.mv + g.cash, base)}</span>
                                  <span className={`ml-3 font-medium ${g.pl >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
                                    {g.pl >= 0 ? "+" : ""}
                                    {money(g.pl, base)}
                                  </span>
                                </span>
                              </div>
                            </td>
                          </tr>
                        )}
                        {g.rows.map((p) => {
                          const mv = (p.last_price ?? 0) * p.shares;
                          const pl = mv - p.avg_cost * p.shares;
                          return (
                            <tr key={p.instrument_id} className="border-t border-slate-100 hover:bg-slate-50/60">
                              <td className="py-2.5 pr-3">
                                <HoldingName symbol={p.symbol} exchange={p.exchange} name={p.name} type={p.type} etf={!!p.sector_weights} sector={p.sector} href={`/dashboard/holding/${p.instrument_id}`} />
                              </td>
                              <td className="whitespace-nowrap px-2 py-2.5 text-right tabular-nums">{num(p.shares, 4)}</td>
                              <td className="whitespace-nowrap px-2 py-2.5 text-right tabular-nums">{money(p.avg_cost, p.currency)}</td>
                              <td
                                className="whitespace-nowrap px-2 py-2.5 text-right tabular-nums"
                                title={p.price_as_of ? `as of ${timeAgo(p.price_as_of)}` : undefined}
                              >
                                {p.last_price == null ? <span className="text-slate-300">—</span> : money(p.last_price, p.currency)}
                              </td>
                              <td className="whitespace-nowrap px-2 py-2.5 text-right tabular-nums">
                                {p.day_change_pct == null ? (
                                  <span className="text-slate-300">—</span>
                                ) : (
                                  <span className={p.day_change_pct >= 0 ? "text-emerald-600" : "text-rose-600"}>
                                    {pct(p.day_change_pct)}
                                  </span>
                                )}
                              </td>
                              <td className="whitespace-nowrap px-2 py-2.5 text-right tabular-nums font-medium">
                                {p.last_price == null ? <span className="text-slate-300">—</span> : money(mv, p.currency)}
                              </td>
                              <td className="whitespace-nowrap px-2 py-2.5 text-right tabular-nums text-slate-500">
                                {p.div_yield_current != null ? pct(p.div_yield_current) : "—"}
                              </td>
                              <td className="whitespace-nowrap px-2 py-2.5 text-right tabular-nums font-medium">
                                {p.last_price == null ? (
                                  <span className="text-slate-300">—</span>
                                ) : (
                                  <span className={pl >= 0 ? "text-emerald-600" : "text-rose-600"}>{money(pl, p.currency)}</span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </Fragment>
                    )) : consolidated.map((p) => {
                      const mv = (p.last_price ?? 0) * p.shares;
                      const pl = mv - p.avg_cost * p.shares;
                      return (
                        <tr key={p.instrument_id} className="border-t border-slate-100 hover:bg-slate-50/60">
                          <td className="py-2.5 pr-3">
                            <HoldingName symbol={p.symbol} exchange={p.exchange} name={p.name} type={p.type} etf={!!p.sector_weights} sector={p.sector} extra={p.accounts.size > 1 ? `${p.accounts.size} accounts` : undefined} href={`/dashboard/holding/${p.instrument_id}`} />
                          </td>
                          <td className="whitespace-nowrap px-2 py-2.5 text-right tabular-nums">{num(p.shares, 4)}</td>
                          <td className="whitespace-nowrap px-2 py-2.5 text-right tabular-nums">{money(p.avg_cost, p.currency)}</td>
                          <td
                            className="whitespace-nowrap px-2 py-2.5 text-right tabular-nums"
                            title={p.price_as_of ? `as of ${timeAgo(p.price_as_of)}` : undefined}
                          >
                            {p.last_price == null ? <span className="text-slate-300">—</span> : money(p.last_price, p.currency)}
                          </td>
                          <td className="whitespace-nowrap px-2 py-2.5 text-right tabular-nums">
                            {p.day_change_pct == null ? (
                              <span className="text-slate-300">—</span>
                            ) : (
                              <span className={p.day_change_pct >= 0 ? "text-emerald-600" : "text-rose-600"}>
                                {pct(p.day_change_pct)}
                              </span>
                            )}
                          </td>
                          <td className="whitespace-nowrap px-2 py-2.5 text-right tabular-nums font-medium">
                            {p.last_price == null ? <span className="text-slate-300">—</span> : money(mv, p.currency)}
                          </td>
                          <td className="whitespace-nowrap px-2 py-2.5 text-right tabular-nums text-slate-500">
                            {p.div_yield_current != null ? pct(p.div_yield_current) : "—"}
                          </td>
                          <td className="whitespace-nowrap px-2 py-2.5 text-right tabular-nums font-medium">
                            {p.last_price == null ? (
                              <span className="text-slate-300">—</span>
                            ) : (
                              <span className={pl >= 0 ? "text-emerald-600" : "text-rose-600"}>{money(pl, p.currency)}</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* Right column: allocation + add + import */}
          <section className="space-y-6">
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-soft">
              <h2 className="text-base font-semibold">What you hold</h2>
              <p className="mb-3 text-xs text-slate-400">How your money is split across holdings.</p>
              {alloc.length ? (
                <AllocationChart data={alloc} currency={base} />
              ) : (
                <p className="py-6 text-center text-sm text-slate-400">Add holdings to see the breakdown.</p>
              )}
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-soft">
              <h2 className="mb-3 text-base font-semibold">Add holding</h2>
              <AddHoldingForm />
              <p className="mt-3 text-xs text-slate-400">Symbol + exchange, e.g. AAPL / US, 0700 / HK.</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-soft">
              <h2 className="mb-3 text-base font-semibold">Import CSV</h2>
              <ImportTransactionsForm />
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-soft">
              <h2 className="mb-1 text-base font-semibold">Export</h2>
              <p className="mb-3 text-xs text-slate-400">
                Your data, no lock-in. Transactions round-trip straight back into Import.
              </p>
              <div className="flex flex-col gap-2">
                <a
                  href="/api/export/transactions"
                  download
                  className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  ↓ Transactions (.csv)
                </a>
                <a
                  href="/api/export/holdings"
                  download
                  className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  ↓ Holdings snapshot (.csv)
                </a>
              </div>
            </div>
          </section>
        </div>
        </>
        )}

        {rows.length > 0 && (
          <div className="mt-6 grid gap-6 lg:grid-cols-2">
            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-soft">
              <h2 className="text-base font-semibold">By sector</h2>
              <p className="mb-4 text-xs text-slate-400">Which industries your money is spread across (funds counted by what they hold).</p>
              <AllocBars items={sectorAlloc} base={base} />
            </section>
            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-soft">
              <div className="mb-1 flex items-center justify-between">
                <h2 className="text-base font-semibold">By region</h2>
                <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-600">
                  International {intlPct.toFixed(1)}%
                </span>
              </div>
              <p className="mb-4 text-xs text-slate-400">How much sits in the US versus the rest of the world.</p>
              <AllocBars items={regionAlloc} base={base} />
            </section>
          </div>
        )}
      </div>
    </main>
  );
}

// Friendly market label for the exchange code we store, so an intl holding reads "HKEX · 1810"
// rather than a bare "HK". Falls back to the raw code for anything unmapped.
const MARKET_LABEL: Record<string, string> = {
  US: "US", HK: "HKEX", TW: "Taiwan", SS: "Shanghai", SZ: "Shenzhen", SI: "SGX",
  KL: "Bursa", BK: "Thailand", TSE: "Tokyo", LSE: "London", TO: "Toronto", AX: "ASX",
  KO: "Korea", NS: "NSE", BO: "BSE", CRYPTO: "Crypto",
};
function marketLabel(exchange: string | null): string {
  const ex = (exchange || "US").toUpperCase();
  return MARKET_LABEL[ex] ?? ex;
}

// Holding identity cell: company name on top (when we have a real one), with a
// "<market> · <ticker>" line plus its category (crypto / ETF / sector) beneath.
function HoldingName({
  symbol,
  exchange,
  name,
  type,
  etf,
  sector,
  extra,
  href,
}: {
  symbol: string;
  exchange: string | null;
  name: string | null;
  type: string | null;
  etf?: boolean;
  sector?: string | null;
  extra?: string;
  href?: string;
}) {
  const hasName = !!name && name.trim() !== "" && name.trim().toUpperCase() !== symbol.toUpperCase();
  const category = type === "crypto" ? "Crypto" : etf ? "ETF" : sector || null;
  // When we have a real name, the top line is the name and the meta line carries "market · ticker".
  // When the name is still pending, the top line IS the ticker, so the meta line shows just the
  // market (no duplicated ticker).
  const marketPart = hasName ? `${marketLabel(exchange)} · ${symbol}` : marketLabel(exchange);
  const meta = [marketPart, category, extra].filter(Boolean).join(" · ");
  const primary = hasName ? name : symbol;
  return (
    <div>
      {href ? (
        <Link href={href} className="font-medium text-slate-900 hover:text-indigo-600 hover:underline">{primary}</Link>
      ) : (
        <div className="font-medium text-slate-900">{primary}</div>
      )}
      <div className="text-xs text-slate-400">{meta}</div>
    </div>
  );
}

function Tile({
  label,
  value,
  sub,
  hint,
  positive,
  accent,
  muted,
  neutral,
}: {
  label: string;
  value: string;
  sub?: string;
  hint?: string;
  positive?: boolean;
  accent?: boolean;
  muted?: boolean;
  neutral?: boolean;
}) {
  return (
    <div
      className={`rounded-2xl border p-4 shadow-soft ${
        accent ? "border-[#205d4a]/25 bg-gradient-to-br from-[#edf3ee] to-white" : "border-slate-200 bg-white"
      }`}
    >
      <div className="flex items-center gap-1 text-[11px] font-medium uppercase tracking-[0.08em] text-slate-400">
        {label}
        {hint && <span title={hint} aria-label={hint} className="cursor-help text-slate-300">ⓘ</span>}
      </div>
      <div
        className={`mt-1.5 tracking-tight tabular-nums ${accent ? "font-display text-[1.7rem] font-medium leading-tight" : "text-2xl font-bold"} ${muted ? "text-slate-500" : "text-slate-900"}`}
      >
        {value}
      </div>
      {sub && (
        <div className={`mt-0.5 text-sm font-medium ${neutral ? "text-emerald-600" : positive ? "text-emerald-600" : "text-rose-600"}`}>
          {sub}
        </div>
      )}
    </div>
  );
}

function AllocBars({
  items,
  base,
}: {
  items: { name: string; value: number; pct: number }[];
  base: string;
}) {
  if (items.length === 0) {
    return <p className="py-6 text-center text-sm text-slate-400">No data yet.</p>;
  }
  return (
    <ul className="space-y-2.5 text-sm">
      {items.slice(0, 10).map((it, i) => (
        <li key={it.name}>
          <div className="mb-1 flex items-center justify-between gap-2">
            <span className="truncate font-medium text-slate-700">{it.name}</span>
            <span className="shrink-0 tabular-nums text-slate-500">
              {it.pct.toFixed(1)}% · {money(it.value, base)}
            </span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
            <div
              className="h-full rounded-full"
              style={{ width: `${Math.max(it.pct, 0.5)}%`, background: CHART_CATEGORICAL[i % CHART_CATEGORICAL.length] }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}
