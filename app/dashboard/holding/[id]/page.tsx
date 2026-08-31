import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ensurePortfolio } from "../../actions";
import DashboardNav from "@/components/DashboardNav";
import DeleteActivityButton from "@/components/DeleteActivityButton";
import RemoveHoldingButton from "@/components/RemoveHoldingButton";
import { money, pct, num, timeAgo } from "@/lib/format";
import { optionActionLabel, legPremium } from "@/lib/options";
import { computeRealizedLots, summarizeRealized, type LedgerTx } from "@/lib/tax/realized";

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
};
type OptTx = {
  id: string; portfolio_id: string; action: string; option_type: string; strike: number;
  expiration: string; contracts: number; premium: number; fee: number; currency: string;
  trade_date: string; note: string | null;
};

type TimelineItem = {
  id: string;                    // the underlying row id, for delete
  source: "tx" | "option";       // which table it came from
  date: string;
  kind: "buy" | "sell" | "dividend" | "option";
  title: string;
  detail: string;
  amount: number | null; // cash flow in the instrument's currency (+ in, − out)
  portfolio: string;
};

export default async function HoldingDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  await ensurePortfolio(); // ensures signed-in

  const [{ data: inst }, { data: pc }, { data: txData }, { data: optData }, { data: pfList }] =
    await Promise.all([
      supabase.from("instruments").select("id, symbol, exchange, name, type, currency, sector, country_iso, annual_div_per_share, div_yield_ttm, next_dividend_date").eq("id", id).maybeSingle(),
      supabase.from("price_cache").select("price, change_pct, as_of").eq("instrument_id", id).maybeSingle(),
      supabase.from("transactions").select("id, portfolio_id, type, quantity, price, fees, currency, executed_at, note").eq("instrument_id", id).order("executed_at", { ascending: false }),
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

  // --- Position math from the raw ledger (works for open and fully-closed positions) ---
  let shares = 0, buyValue = 0, buyShares = 0, divPaid = 0;
  for (const t of txs) {
    if (t.type === "buy") { shares += t.quantity; buyValue += t.quantity * t.price + t.fees; buyShares += t.quantity; }
    else if (t.type === "sell") shares -= t.quantity;
    else if (t.type === "dividend") divPaid += t.quantity * t.price;
  }
  const avgCost = buyShares > 0 ? buyValue / buyShares : 0;
  const netPremium = opts.reduce((s, o) => s + legPremium(o), 0); // signed, kept

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
  const ledger: LedgerTx[] = txs.map((t) => ({
    symbol: instrument.symbol, exchange: instrument.exchange, currency: ccy, type: t.type,
    quantity: t.quantity, price: t.price, fees: t.fees, executed_at: t.executed_at,
  }));
  const realized = summarizeRealized(computeRealizedLots(ledger), () => 1);

  const totalIncome = netPremium + divPaid;

  // --- Unified activity timeline (equity + options + dividends), newest first ---
  const timeline: TimelineItem[] = [];
  for (const t of txs) {
    const portfolio = pfName.get(t.portfolio_id) ?? "Portfolio";
    if (t.type === "buy") timeline.push({ id: t.id, source: "tx", date: t.executed_at, kind: "buy", title: "Bought shares", detail: `${num(t.quantity, 4)} @ ${money(t.price, ccy)}${t.fees ? ` · ${money(t.fees, ccy)} fee` : ""}`, amount: -(t.quantity * t.price + t.fees), portfolio });
    else if (t.type === "sell") timeline.push({ id: t.id, source: "tx", date: t.executed_at, kind: "sell", title: "Sold shares", detail: `${num(t.quantity, 4)} @ ${money(t.price, ccy)}${t.fees ? ` · ${money(t.fees, ccy)} fee` : ""}`, amount: t.quantity * t.price - t.fees, portfolio });
    else if (t.type === "dividend") timeline.push({ id: t.id, source: "tx", date: t.executed_at, kind: "dividend", title: "Dividend received", detail: `${money(t.price, ccy)}/sh × ${num(t.quantity, 4)}`, amount: t.quantity * t.price, portfolio });
  }
  for (const o of opts) {
    const portfolio = pfName.get(o.portfolio_id) ?? "Portfolio";
    const label = optionActionLabel(o.action);
    timeline.push({
      id: o.id, source: "option",
      date: o.trade_date, kind: "option",
      title: `${label} ${o.option_type === "put" ? "put" : "call"}`,
      detail: `${o.contracts}× ${money(o.strike, o.currency)} strike · exp ${o.expiration} · ${money(o.premium, o.currency)}/sh`,
      amount: legPremium(o), portfolio,
    });
  }
  timeline.sort((a, b) => b.date.localeCompare(a.date));

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
                <Stat
                  label="Break-even vs. now"
                  value={pct(((price - effectiveCost) / effectiveCost) * 100)}
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

        {/* Full activity timeline */}
        <section className="mt-8 rounded-2xl border border-slate-200 bg-white p-5">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-semibold">Everything on {instrument.symbol}</h2>
            <RemoveHoldingButton instrumentId={id} symbol={instrument.symbol} />
          </div>
          <ul className="space-y-1">
            {timeline.map((item) => (
              <li key={`${item.source}:${item.id}`} className="group flex items-center justify-between gap-3 border-b border-slate-50 py-2.5 last:border-0">
                <div className="flex items-center gap-3">
                  <span className={`mt-0.5 h-2 w-2 shrink-0 rounded-full ${dot(item.kind)}`} />
                  <div>
                    <div className="text-sm font-medium">{item.title}</div>
                    <div className="text-xs text-slate-400">{item.detail}</div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <div className="text-right">
                    {item.amount != null && (
                      <div className={`text-sm font-medium tabular-nums ${item.amount >= 0 ? "text-emerald-600" : "text-slate-600"}`}>
                        {item.amount >= 0 ? "+" : ""}{money(item.amount, ccy)}
                      </div>
                    )}
                    <div className="text-xs text-slate-400">{item.date}</div>
                  </div>
                  <DeleteActivityButton id={item.id} instrumentId={id} source={item.source} />
                </div>
              </li>
            ))}
          </ul>
        </section>

        {priceAsOf && (
          <p className="mt-4 text-center text-xs text-slate-400">Price as of {timeAgo(priceAsOf)}</p>
        )}
      </div>
    </main>
  );
}

function dot(kind: TimelineItem["kind"]): string {
  return kind === "buy" ? "bg-[#4f9580]" : kind === "sell" ? "bg-slate-400" : kind === "dividend" ? "bg-emerald-500" : "bg-[#b98a34]";
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

function Stat({ label, value, strike, accent, tone }: { label: string; value: string; strike?: boolean; accent?: boolean; tone?: "up" | "down" }) {
  const t = tone === "up" ? "text-emerald-600" : tone === "down" ? "text-rose-600" : accent ? "text-indigo-600" : "text-slate-900";
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-slate-400">{label}</div>
      <div className={`mt-0.5 text-xl font-semibold ${t} ${strike ? "line-through decoration-slate-300" : ""}`}>{value}</div>
    </div>
  );
}
