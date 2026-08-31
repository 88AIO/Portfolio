import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ensurePortfolio } from "../../actions";
import DashboardNav from "@/components/DashboardNav";
import ActivityList, { type ActivityItem } from "@/components/ActivityList";
import RemoveHoldingButton from "@/components/RemoveHoldingButton";
import { money, pct, num, timeAgo } from "@/lib/format";
import { optionActionLabel, legPremium } from "@/lib/options";
import { computeRealizedLots, summarizeRealized, type LedgerTx } from "@/lib/tax/realized";
import { loadSplitRecords } from "@/lib/corporate/load";
import { splitFactor } from "@/lib/corporate/splits";
import { getCachedRates } from "@/lib/fx";
import SplitsSection from "@/components/SplitsSection";
import { isDripBuy } from "@/lib/dividends/drip";
import { isBrokerRestated, isBrokerCashDividend } from "@/lib/brokersync/restated";

export const dynamic = "force-dynamic";

type Instrument = {
  id: string; symbol: string; exchange: string; name: string | null; type: string | null;
  currency: string; sector: string | null; country_iso: string | null;
  annual_div_per_share: number | null; div_yield_ttm: number | null;
  next_dividend_date: string | null;
};
type Tx = {
  id: string; portfolio_id: string; type: string; quantity: number; price: number;
  fees: number; currency: string; executed_at: string; note: string | null;
  // Nullable in the type, not the column: a database that predates the column returns undefined
  // for it, and that must read as "not a reinvestment" rather than crash the page.
  drip?: boolean | null;
  dedupe_key?: string | null;
};
type OptTx = {
  id: string; portfolio_id: string; action: string; option_type: string; strike: number;
  expiration: string; contracts: number; premium: number; fee: number; currency: string;
  trade_date: string; note: string | null;
};

export default async function HoldingDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  await ensurePortfolio(); // ensures signed-in

  const [{ data: inst }, { data: pc }, { data: txData }, { data: optData }, { data: pfList }] =
    await Promise.all([
      supabase.from("instruments").select("id, symbol, exchange, name, type, currency, sector, country_iso, annual_div_per_share, div_yield_ttm, next_dividend_date").eq("id", id).maybeSingle(),
      supabase.from("price_cache").select("price, change_pct, as_of").eq("instrument_id", id).maybeSingle(),
      supabase.from("transactions").select("id, portfolio_id, type, quantity, price, fees, currency, executed_at, note, drip, dedupe_key").eq("instrument_id", id).order("executed_at", { ascending: false }),
      supabase.from("option_transactions").select("id, portfolio_id, action, option_type, strike, expiration, contracts, premium, fee, currency, trade_date, note").eq("instrument_id", id).order("trade_date", { ascending: false }),
      supabase.from("portfolios").select("id, name"),
    ]);

  const instrument = inst as Instrument | null;
  const txs = (txData ?? []) as Tx[];
  const opts = (optData ?? []) as OptTx[];
  // No holdings AND no options for this instrument that the user owns → nothing to show.
  if (!instrument || (txs.length === 0 && opts.length === 0)) notFound();

  const ccy = instrument.currency || "USD";
  const price = (pc as { price: number | null } | null)?.price ?? null;
  const changePct = (pc as { change_pct: number | null } | null)?.change_pct ?? null;
  const priceAsOf = (pc as { as_of: string | null } | null)?.as_of ?? null;
  const pfName = new Map<string, string>((pfList ?? []).map((p: { id: string; name: string }) => [p.id, p.name]));

  // Splits, loaded before the position math because the share count depends on them. This page
  // computes from the raw ledger rather than reading the positions view, so it has to apply the
  // same adjustment the view does — otherwise a split would move the dashboard's share count and
  // leave this page's disagreeing with it.
  const splitRecords = (await loadSplitRecords(supabase, [id])).get(id) ?? [];
  const splits = splitRecords.map((r) => ({ exDate: r.exDate, ratio: r.ratio }));
  const holdingSplits = new Map([[id, splits]]);
  // A broker's opening-balance lot is already in today's shares (lib/brokersync/restated.ts).
  const sharesOf = (t: Tx) => t.quantity * (isBrokerRestated(t.dedupe_key) ? 1 : splitFactor(splits, t.executed_at));

  // Every figure on this page is shown in the instrument's own currency, but a transaction can be
  // recorded in another one — an ADR paying its dividend in the home currency, say. Summing those
  // raw would add unlike units and print a total that is simply not a quantity of anything.
  const txCurrencies = [...txs.map((t) => t.currency), ...opts.map((o) => o.currency)];
  const rates = await getCachedRates(supabase, txCurrencies, ccy);
  const fxTo = (c: string | null | undefined) => rates[(c || ccy).toUpperCase()] ?? 1;

  // --- Position math from the raw ledger (works for open and fully-closed positions) ---
  let shares = 0, buyValue = 0, buyShares = 0, divPaid = 0;
  for (const t of txs) {
    const r = fxTo(t.currency);
    // Share counts scale with splits; money does not — a split changes how many pieces you hold,
    // never what you paid or were paid.
    if (t.type === "buy") { shares += sharesOf(t); buyValue += (t.quantity * t.price + t.fees) * r; buyShares += sharesOf(t); }
    else if (t.type === "sell") shares -= sharesOf(t);
    else if (t.type === "dividend") divPaid += t.quantity * t.price * r;
  }
  const avgCost = buyShares > 0 ? buyValue / buyShares : 0;
  const netPremium = opts.reduce((s, o) => s + legPremium(o) * fxTo(o.currency), 0); // signed, kept

  const marketValue = price != null ? price * shares : 0;
  const costBasis = avgCost * shares;
  const unrealized = price != null ? marketValue - costBasis : 0;

  // Effective cost per share — the seller's real basis: what you paid, less the premium (and
  // optionally dividends) you've collected on this name. This is the "premium lowered my price".
  const premiumPerShare = shares > 0 ? netPremium / shares : 0;
  const incomePerShare = shares > 0 ? (netPremium + divPaid) / shares : 0;
  const effectiveCost = avgCost - premiumPerShare;
  const effectiveCostAfterIncome = avgCost - incomePerShare;

  // Realized gains (FIFO) on this symbol.
  // Each row keeps its OWN currency. computeRealizedLots groups by symbol/exchange/currency
  // precisely so a GBP buy can never become the cost basis for a USD sale; forcing every row to the
  // instrument's currency here defeated that guard on the one page that shows the lots.
  const ledger: LedgerTx[] = txs.map((t) => ({
    instrument_id: id, dedupe_key: t.dedupe_key, symbol: instrument.symbol, exchange: instrument.exchange,
    currency: t.currency || ccy, type: t.type,
    quantity: t.quantity, price: t.price, fees: t.fees, executed_at: t.executed_at,
  }));
  // Without splits, a pre-split buy cannot cover a post-split sale: FIFO finds a quarter of the
  // shares it needs and books the rest as a zero-basis gain, which overstates the realized profit.
  const realized = summarizeRealized(computeRealizedLots(ledger, holdingSplits), fxTo);

  const totalIncome = netPremium + divPaid;

  // --- Unified activity timeline (equity + options + dividends), newest first ---
  // Three separate stories, not one mixed feed. "How did I build this position", "what has it
  // actually paid me" and "what have I run against it" are different questions, and interleaving
  // them by date answers none of them well.
  const shareActivity: ActivityItem[] = [];
  const dividendActivity: ActivityItem[] = [];
  const optionActivity: ActivityItem[] = [];

  let restatedShares = 0;
  let dripShares = 0;
  let dripCost = 0;
  let dividendsReceived = 0;

  for (const t of txs) {
    const portfolio = pfName.get(t.portfolio_id) ?? "Portfolio";
    if (t.type === "buy" || t.type === "sell") {
      // A broker-reconciled lot is not a trade anyone made. It is the gap between the trades the
      // broker's feed could still see and the position it reports today, booked at the broker's
      // average cost on the earliest date we know about. Labelling it "Bought shares" invites
      // someone to read a real purchase — at a price and on a date that never happened.
      const restated = isBrokerRestated(t.dedupe_key);
      const fromNote = isDripBuy(t.type, t.note);
      const drip = !restated && isDripBuy(t.type, t.note, t.drip);
      if (drip) {
        dripShares += sharesOf(t);
        dripCost += (t.quantity * t.price + (t.fees ?? 0)) * fxTo(t.currency);
      }
      if (restated) restatedShares += sharesOf(t);
      shareActivity.push({
        id: t.id, source: "tx", date: t.executed_at, kind: t.type,
        title: restated ? "Opening balance" : t.type === "buy" ? "Bought shares" : "Sold shares",
        detail: restated
          ? `${num(t.quantity, 4)} shares at your broker's average cost of ${money(t.price, t.currency || ccy)} — shares you already held before ${t.executed_at}, not a trade on that date`
          : `${num(t.quantity, 4)} @ ${money(t.price, t.currency || ccy)}${t.fees ? ` · ${money(t.fees, t.currency || ccy)} fee` : ""}`,
        amount: t.type === "buy" ? -(t.quantity * t.price + t.fees) : t.quantity * t.price - t.fees,
        portfolio,
        // Only real buys can be reinvestments; a sell or a reconciling lot has nothing to toggle.
        drip: t.type === "buy" && !restated ? { isDrip: drip, locked: fromNote } : undefined,
      });
    } else if (t.type === "dividend") {
      dividendsReceived += t.quantity * t.price * fxTo(t.currency);
      dividendActivity.push({
        id: t.id, source: "tx", date: t.executed_at, kind: "dividend",
        title: "Dividend received",
        // A broker row carries the cash amount, not a rate. Printing "$64.32/sh × 1" for it would
        // state a per-share dividend six hundred times NVDA's real one.
        detail: isBrokerCashDividend(t.type, t.dedupe_key)
          ? "Cash dividend, as reported by your broker"
          : `${money(t.price, t.currency || ccy)}/sh × ${num(t.quantity, 4)}`,
        amount: t.quantity * t.price, portfolio,
      });
    }
  }
  for (const o of opts) {
    const portfolio = pfName.get(o.portfolio_id) ?? "Portfolio";
    const label = optionActionLabel(o.action);
    optionActivity.push({
      id: o.id, source: "option",
      date: o.trade_date, kind: "option",
      title: `${label} ${o.option_type === "put" ? "put" : "call"}`,
      detail: `${o.contracts}× ${money(o.strike, o.currency)} strike · exp ${o.expiration} · ${money(o.premium, o.currency)}/sh`,
      amount: legPremium(o), portfolio,
    });
  }
  for (const list of [shareActivity, dividendActivity, optionActivity]) {
    list.sort((a, b) => b.date.localeCompare(a.date));
  }

  const openOptions = opts.filter((o) => o.action === "sell_to_open"); // display list of sold legs
  const heldNow = shares > 0.0000001;

  return (
    <main className="min-h-screen bg-slate-50 text-slate-800">
      <DashboardNav active="overview" />

      <div className="mx-auto max-w-5xl px-6 py-8">
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="font-display text-2xl font-medium tracking-tight text-slate-900">{instrument.name && instrument.name !== instrument.symbol ? instrument.name : instrument.symbol}</h1>
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500">
                {instrument.exchange} · {instrument.symbol}
              </span>
            </div>
            {instrument.sector && <div className="mt-0.5 text-xs text-slate-400">{instrument.sector}{instrument.country_iso ? ` · ${instrument.country_iso}` : ""}</div>}
          </div>
          <Link href="/dashboard" className="shrink-0 text-sm text-indigo-600 hover:underline">← Back to dashboard</Link>
        </div>

        {/* Position snapshot */}
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <Card label="Shares" value={heldNow ? num(shares, 4) : "0 (closed)"} />
          <Card label="Last price" value={price != null ? money(price, ccy) : "—"} sub={changePct != null ? pct(changePct) : undefined} tone={changePct != null ? (changePct >= 0 ? "up" : "down") : undefined} />
          <Card label="Market value" value={heldNow ? money(marketValue, ccy) : "—"} />
          <Card label="Unrealized P/L" value={heldNow ? money(unrealized, ccy) : "—"} tone={unrealized >= 0 ? "up" : "down"} />
        </div>

        {/* Effective cost — the headline "premium lowered my share price" */}
        {heldNow && buyShares > 0 && (
          <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-5">
            <h2 className="mb-1 font-semibold">Your effective cost per share</h2>
            <p className="mb-4 text-xs text-slate-400">
              Premium you&apos;ve collected selling options on {instrument.symbol} lowers what the shares
              really cost you. Dividends lower it further.
            </p>
            <div className="flex flex-wrap items-end gap-x-8 gap-y-3">
              <Stat label="Paid (avg cost)" value={money(avgCost, ccy)} strike />
              {netPremium !== 0 && (
                <Stat label="− Option premium" value={`${money(premiumPerShare, ccy)}/sh`} />
              )}
              <Stat label="Effective cost" value={money(effectiveCost, ccy)} accent />
              {divPaid > 0 && (
                <Stat label="After dividends too" value={money(effectiveCostAfterIncome, ccy)} accent />
              )}
              {price != null && effectiveCost !== 0 && (
                // Named for what it measures. "Break-even vs. now" described neither a break-even
                // price nor a break-even percentage, and sitting to the right of the
                // after-dividends figure it invited the assumption that it used that one — it uses
                // the premium-only effective cost, so the sub-line names the number outright.
                <Stat
                  label="Return on effective cost"
                  value={pct(((price - effectiveCost) / effectiveCost) * 100)}
                  sub={`vs. ${money(effectiveCost, ccy)}`}
                  hint={`Today's price of ${money(price, ccy)} against your effective cost of ${money(effectiveCost, ccy)} — what you paid, less option premium. Dividends are not included here.`}
                  tone={price >= effectiveCost ? "up" : "down"}
                />
              )}
            </div>
          </section>
        )}

        {/* Income + realized summary */}
        <div className="mt-6 grid grid-cols-2 gap-4 md:grid-cols-4">
          <Card label="Option premium" value={money(netPremium, ccy)} tone={netPremium >= 0 ? "up" : "down"} sub="net kept" />
          <Card label="Dividends received" value={money(divPaid, ccy)} />
          <Card label="Total income" value={money(totalIncome, ccy)} tone={totalIncome >= 0 ? "up" : "down"} sub="premium + divs" />
          <Card label="Realized gain" value={money(realized.totalGain, ccy)} tone={realized.totalGain >= 0 ? "up" : "down"} sub={`${realized.lotCount} closed lot${realized.lotCount === 1 ? "" : "s"}`} />
        </div>

        {/* Open option legs on this name */}
        {openOptions.length > 0 && (
          <section className="mt-8 rounded-2xl border border-slate-200 bg-white p-5">
            <h2 className="mb-3 font-semibold">Options sold on {instrument.symbol}</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase text-slate-400">
                  <tr>
                    <th className="pb-2 pr-2">Type</th>
                    <th className="px-2 pb-2 text-right">Contracts</th>
                    <th className="px-2 pb-2 text-right">Strike</th>
                    <th className="px-2 pb-2">Expiration</th>
                    <th className="px-2 pb-2 text-right">Premium/sh</th>
                    <th className="px-2 pb-2 text-right">Collected</th>
                  </tr>
                </thead>
                <tbody>
                  {openOptions.map((o) => (
                    <tr key={o.id} className="border-t border-slate-100">
                      <td className="py-2.5 pr-2">
                        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${o.option_type === "put" ? "bg-[#edf3ee] text-[#205d4a]" : "bg-[#f6ecd8] text-[#8a6a1f]"}`}>
                          {o.option_type === "put" ? "Cash-secured put" : "Covered call"}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-2 py-2.5 text-right tabular-nums">{o.contracts}</td>
                      <td className="whitespace-nowrap px-2 py-2.5 text-right tabular-nums">{money(o.strike, o.currency)}</td>
                      <td className="whitespace-nowrap px-2 py-2.5">{o.expiration}</td>
                      <td className="whitespace-nowrap px-2 py-2.5 text-right tabular-nums">{money(o.premium, o.currency)}</td>
                      <td className="whitespace-nowrap px-2 py-2.5 text-right tabular-nums font-medium">{money(o.premium * o.contracts * 100 - o.fee, o.currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        <SplitsSection instrumentId={id} symbol={instrument.symbol} splits={splitRecords} />

        {/* Options run against this name */}
        <section className="mt-8 rounded-2xl border border-slate-200 bg-white p-5">
          <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="font-semibold">Options on {instrument.symbol}</h2>
            <span className="text-sm text-slate-500">
              {money(netPremium, ccy)} net premium
            </span>
          </div>
          <p className="mb-4 text-xs text-slate-400">
            Every leg you&apos;ve opened, closed, rolled or let expire on this name. Open legs are
            summarised above; this is the full record, newest first.
          </p>
          <ActivityList
            items={optionActivity}
            instrumentId={id}
            currency={ccy}
            empty={`No options recorded on ${instrument.symbol} yet.`}
          />
        </section>

        {/* Dividends actually paid on this name */}
        <section className="mt-8 rounded-2xl border border-slate-200 bg-white p-5">
          <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="font-semibold">Dividends from {instrument.symbol}</h2>
            <span className="text-sm text-slate-500">{money(dividendsReceived, ccy)} received</span>
          </div>
          <p className="mb-4 text-xs text-slate-400">
            What this holding has actually paid you, from your own transactions. Option premium is
            never counted here — it&apos;s in the section above.
          </p>
          <ActivityList
            items={dividendActivity}
            instrumentId={id}
            currency={ccy}
            empty={`No dividends recorded from ${instrument.symbol} yet.`}
          />
        </section>

        {/* How the position was built */}
        <section className="mt-8 rounded-2xl border border-slate-200 bg-white p-5">
          <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-semibold">Purchase history</h2>
            <RemoveHoldingButton instrumentId={id} symbol={instrument.symbol} />
          </div>
          <p className="mb-4 text-xs text-slate-400">
            Every share bought and sold, newest first.
            {restatedShares > 0 && (
              <>
                {" "}
                <span className="font-medium text-slate-500">
                  {num(restatedShares, 4)} shares show as an opening balance
                </span>{" "}
                — your broker&apos;s records don&apos;t reach back far enough to itemise those
                purchases, so they&apos;re entered once at its average cost. The date is the
                earliest one the broker gave us, not when you bought them.
              </>
            )}
            {dripShares > 0 ? (
              <>
                {" "}
                <span className="font-medium text-slate-500">
                  {num(dripShares, 4)} of your shares came from reinvested dividends
                </span>{" "}
                ({money(dripCost, ccy)}), marked DRIP.
              </>
            ) : (
              " Hover a purchase and click DRIP to mark it as a reinvested dividend. Imports mark themselves when your broker's description says so."
            )}
          </p>
          <ActivityList
            items={shareActivity}
            instrumentId={id}
            currency={ccy}
            empty={`No share transactions recorded for ${instrument.symbol} yet.`}
          />
        </section>

        {priceAsOf && (
          <p className="mt-4 text-center text-xs text-slate-400">Price as of {timeAgo(priceAsOf)}</p>
        )}
      </div>
    </main>
  );
}

function Card({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "up" | "down" }) {
  const t = tone === "up" ? "text-emerald-600" : tone === "down" ? "text-rose-600" : "text-slate-900";
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="text-xs uppercase tracking-wide text-slate-400">{label}</div>
      <div className={`mt-1 text-lg font-semibold ${t}`}>{value}</div>
      {sub && <div className="mt-0.5 text-xs text-slate-400">{sub}</div>}
    </div>
  );
}

function Stat({ label, value, strike, accent, tone, sub, hint }: { label: string; value: string; strike?: boolean; accent?: boolean; tone?: "up" | "down"; sub?: string; hint?: string }) {
  const t = tone === "up" ? "text-emerald-600" : tone === "down" ? "text-rose-600" : accent ? "text-indigo-600" : "text-slate-900";
  return (
    <div>
      <div className="flex items-center gap-1 text-xs uppercase tracking-wide text-slate-400">
        {label}
        {hint && <span title={hint} aria-label={hint} className="cursor-help text-slate-300">ⓘ</span>}
      </div>
      <div className={`mt-0.5 text-xl font-semibold ${t} ${strike ? "line-through decoration-slate-300" : ""}`}>{value}</div>
      {sub && <div className="mt-0.5 text-xs text-slate-400">{sub}</div>}
    </div>
  );
}
