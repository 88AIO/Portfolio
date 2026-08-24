import Link from "next/link";
import BrandMark from "@/components/BrandMark";
import { createClient } from "@/lib/supabase/server";
import { ensurePortfolio } from "../actions";
import { fetchAll } from "@/lib/supabase/paginate";
import { getCachedRates } from "@/lib/fx";
import { money, pct, num } from "@/lib/format";
import {
  computeOption,
  computeOptionTotals,
  statusLabel,
  type OptionPositionRow,
  type ComputedOption,
  type AttentionItem,
} from "@/lib/options";
import { computeWheels, type WheelPosition, type WheelRow, type WheelEvent } from "@/lib/options/wheel";
import { computeRealizedLots, summarizeRealized, type LedgerTx } from "@/lib/tax/realized";
import AddOptionForm from "@/components/AddOptionForm";
import WheelCycles from "@/components/WheelCycles";
import MonthlyPremiumChart from "@/components/MonthlyPremiumChart";
import PricesAsOf, { oldestPriceAsOf } from "@/components/PricesAsOf";
import NotificationSettings from "@/components/NotificationSettings";
import { getNotificationPrefs } from "./actions";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type PositionLite = {
  symbol: string;
  currency: string;
  shares: number;
  avg_cost: number | null;
  last_price: number | null;
  price_as_of: string | null;
  div_paid: number | null;
  option_premium: number | null;
  next_dividend_date: string | null;
  next_dividend_per_share: number | null;
  annual_div_per_share: number | null;
  div_frequency: number | null;
};

// Raw ledger row joined to its instrument symbol, for per-symbol realized-gain math.
type LedgerRow = {
  type: string;
  quantity: number;
  price: number;
  fees: number | null;
  currency: string;
  executed_at: string;
  instruments: { symbol: string } | { symbol: string }[] | null;
};

// Raw option-transaction leg joined to its underlying symbol, for the per-ticker wheel history.
type OptTxnRow = {
  action: string;
  option_type: string;
  strike: number;
  expiration: string;
  contracts: number;
  premium: number;
  fee: number | null;
  currency: string;
  trade_date: string;
  instruments: { symbol: string } | { symbol: string }[] | null;
};

function relSymbol(rel: { symbol: string } | { symbol: string }[] | null): string {
  const r = Array.isArray(rel) ? rel[0] : rel;
  return r?.symbol ?? "";
}

export default async function OptionsPage() {
  const supabase = await createClient();
  const portfolio = await ensurePortfolio();
  const base = portfolio.base_currency || "USD";

  const [{ data: optRows }, { data: posRows }, { data: pfList }, ledger, { data: optTxnRows }, notifPrefs] = await Promise.all([
    supabase.from("option_positions").select("*").order("expiration"),
    supabase.from("positions").select(
      "symbol, currency, shares, avg_cost, last_price, price_as_of, div_paid, option_premium, next_dividend_date, next_dividend_per_share, annual_div_per_share, div_frequency"
    ),
    supabase.from("portfolios").select("id, name").order("created_at"),
    // Page past the ~1000-row cap so per-ticker stock gains see the full trade ledger.
    fetchAll<LedgerRow>((from, to) =>
      supabase
        .from("transactions")
        .select("type, quantity, price, fees, currency, executed_at, instruments(symbol)")
        .order("executed_at", { ascending: true })
        .order("instrument_id", { ascending: true })
        .range(from, to),
    ),
    supabase.from("option_transactions").select("action, option_type, strike, expiration, contracts, premium, fee, currency, trade_date, instruments(symbol)"),
    getNotificationPrefs(),
  ]);

  const rawOptions = (optRows ?? []) as OptionPositionRow[];
  const positions = (posRows ?? []) as PositionLite[];
  const portfolios = (pfList ?? []) as { id: string; name: string }[];
  const optTxns = (optTxnRows ?? []) as OptTxnRow[];

  // FX across every currency in play (options + equity positions).
  const currencies = [...rawOptions.map((o) => o.currency), ...positions.map((p) => p.currency)];
  const rates = await getCachedRates(supabase, currencies, base);
  const fx = (ccy: string) => rates[ccy] ?? 1;

  const computed: ComputedOption[] = rawOptions.map(computeOption);
  const totals = computeOptionTotals(computed, fx);

  // Income integration: realized dividends + net option premium = total income.
  let dividendsReceived = 0;
  let costBasisReduction = 0;
  for (const p of positions) {
    const r = fx(p.currency);
    dividendsReceived += (p.div_paid ?? 0) * r;
    costBasisReduction += Math.max(p.option_premium ?? 0, 0) * r;
  }
  const totalIncome = dividendsReceived + totals.premiumIncome;

  const open = computed
    .filter((o) => o.isOpen)
    .sort((a, b) => a.dte - b.dte);

  // O2 — needs attention: likely assignments, near expiries, upcoming ex-dividends.
  const today = new Date().toISOString().slice(0, 10);
  const in14 = new Date(new Date(`${today}T00:00:00Z`).getTime() + 14 * 86400000)
    .toISOString()
    .slice(0, 10);

  // --- Premium income over time: every option leg aggregated by trade month ---
  // Canonical sign: credit on open (sell_to_open), debit on close/roll, fee always a cost.
  const legPrem = (o: OptTxnRow): number => {
    const gross = (o.premium ?? 0) * (o.contracts ?? 0) * 100;
    const fee = o.fee ?? 0;
    if (o.action === "sell_to_open") return gross - fee;
    if (o.action === "buy_to_close" || o.action === "rolled") return -gross - fee;
    return -fee;
  };
  const premByMonth = new Map<string, number>();
  let premYtd = 0;
  let premAllTime = 0;
  const curYear = today.slice(0, 4);
  for (const o of optTxns) {
    if (!o.trade_date) continue;
    const net = legPrem(o) * fx(o.currency);
    const m = o.trade_date.slice(0, 7);
    premByMonth.set(m, (premByMonth.get(m) ?? 0) + net);
    premAllTime += net;
    if (o.trade_date.slice(0, 4) === curYear) premYtd += net;
  }
  // Continuous month axis (fill empty months with 0 so the income rhythm reads honestly).
  const monthKeys = [...premByMonth.keys()].sort();
  const premiumSeries: { month: string; premium: number }[] = [];
  if (monthKeys.length) {
    const [sy, sm] = monthKeys[0].split("-").map(Number);
    const [ey, em] = monthKeys[monthKeys.length - 1].split("-").map(Number);
    let y = sy;
    let mo = sm;
    while (y < ey || (y === ey && mo <= em)) {
      const key = `${y}-${String(mo).padStart(2, "0")}`;
      premiumSeries.push({ month: key, premium: Math.round(premByMonth.get(key) ?? 0) });
      mo += 1;
      if (mo > 12) { mo = 1; y += 1; }
    }
  }
  const activeMonths = premiumSeries.filter((p) => p.premium !== 0).length;
  const avgPerMonth = activeMonths ? premAllTime / activeMonths : 0;

  const attention: AttentionItem[] = [];
  for (const o of open) {
    if (o.status === "may_be_assigned") {
      attention.push({
        kind: "assignment", symbol: o.symbol, severity: "warn", date: o.expiration,
        detail: `${o.symbol} ${money(o.strike, o.currency)} ${o.option_type} is in-the-money with ${o.dte}d left, may be assigned`,
      });
    } else if (o.dte >= 0 && o.dte <= 7) {
      attention.push({
        kind: "expiry", symbol: o.symbol, severity: "info", date: o.expiration,
        detail: `${o.symbol} ${money(o.strike, o.currency)} ${o.option_type} expires in ${o.dte}d`,
      });
    }
  }
  for (const p of positions) {
    if (p.shares > 0 && p.next_dividend_date && p.next_dividend_date >= today && p.next_dividend_date <= in14) {
      const est =
        p.next_dividend_per_share ??
        (p.annual_div_per_share && p.div_frequency ? p.annual_div_per_share / p.div_frequency : null);
      attention.push({
        kind: "ex_dividend", symbol: p.symbol, severity: "info", date: p.next_dividend_date,
        detail: `${p.symbol} goes ex-dividend${est != null ? ` (~${money(est * p.shares, p.currency)})` : ""}`,
      });
    }
  }
  attention.sort((a, b) => a.date.localeCompare(b.date));

  // O2 — the wheel as one story: each underlying's option premium + dividends + realized stock P/L,
  // its current phase (selling puts / covered call / holding / idle) and a blended annualized return.
  // Realized stock P/L per symbol comes from FIFO lot-matching the raw equity ledger.
  const realizedLots = computeRealizedLots(
    ledger.map((t): LedgerTx => {
      const rel = Array.isArray(t.instruments) ? t.instruments[0] : t.instruments;
      return {
        symbol: rel?.symbol ?? "",
        currency: t.currency,
        type: t.type,
        quantity: t.quantity,
        price: t.price,
        fees: t.fees ?? 0,
        executed_at: t.executed_at,
      };
    }).filter((t) => t.symbol)
  );
  const realizedBySymbol = new Map<string, number>();
  const lotsBySymbol = new Map<string, typeof realizedLots>();
  for (const lot of realizedLots) {
    const arr = lotsBySymbol.get(lot.symbol);
    if (arr) arr.push(lot);
    else lotsBySymbol.set(lot.symbol, [lot]);
  }
  for (const [symbol, lots] of lotsBySymbol) {
    realizedBySymbol.set(symbol, summarizeRealized(lots, fx).totalGain);
  }

  // Current equity state per option-active underlying (shares, avg cost, price, dividends).
  const wheelPositions = new Map<string, WheelPosition>();
  for (const p of positions) {
    if (!p.symbol) continue;
    wheelPositions.set(p.symbol, {
      symbol: p.symbol,
      currency: p.currency,
      shares: p.shares,
      avg_cost: p.avg_cost ?? 0,
      last_price: p.last_price,
      div_paid: p.div_paid,
    });
  }
  const wheels: WheelRow[] = computeWheels(computed, wheelPositions, realizedBySymbol, fx, today);

  // Per-ticker wheel history — every option leg since inception, plus the linked share
  // assignments and dividends, one chronological list per underlying. Feeds the expandable
  // rows in the Wheel cycles table. Only names that have option activity get a history.
  const historyBySymbol: Record<string, WheelEvent[]> = {};
  const pushEvent = (symbol: string, e: WheelEvent) => {
    if (!symbol) return;
    (historyBySymbol[symbol] ??= []).push(e);
  };
  for (const o of optTxns) {
    const symbol = relSymbol(o.instruments);
    const ccy = o.currency || base;
    const gross = (o.premium ?? 0) * (o.contracts ?? 0) * 100;
    const fee = o.fee ?? 0;
    const isPut = o.option_type === "put";
    let title: string, amount: number;
    if (o.action === "sell_to_open") { title = `Sold ${isPut ? "put" : "call"}`; amount = gross - fee; }
    else if (o.action === "buy_to_close") { title = "Bought to close"; amount = -gross - fee; }
    else if (o.action === "rolled") { title = "Rolled"; amount = -gross - fee; }
    else if (o.action === "assigned") { title = "Assigned"; amount = -fee; }
    else { title = "Expired"; amount = -fee; }
    pushEvent(symbol, {
      date: o.trade_date, kind: "option", currency: ccy, amount,
      title,
      detail: `${o.contracts}× ${money(o.strike, ccy)} strike · exp ${o.expiration} · ${money(o.premium, ccy)}/sh`,
    });
  }
  // Equity + dividend legs, but only for names that already have option activity (keeps this an
  // options view — a wheel — rather than a full portfolio ledger).
  for (const t of ledger) {
    const symbol = relSymbol(t.instruments);
    if (!symbol || !historyBySymbol[symbol]) continue;
    const ccy = t.currency || base;
    const fees = t.fees ?? 0;
    if (t.type === "buy") {
      pushEvent(symbol, { date: t.executed_at, kind: "buy", currency: ccy, amount: -(t.quantity * t.price + fees), title: "Bought shares", detail: `${num(t.quantity, 4)} @ ${money(t.price, ccy)}${fees ? ` · ${money(fees, ccy)} fee` : ""}` });
    } else if (t.type === "sell") {
      pushEvent(symbol, { date: t.executed_at, kind: "sell", currency: ccy, amount: t.quantity * t.price - fees, title: "Sold shares", detail: `${num(t.quantity, 4)} @ ${money(t.price, ccy)}${fees ? ` · ${money(fees, ccy)} fee` : ""}` });
    } else if (t.type === "dividend") {
      pushEvent(symbol, { date: t.executed_at, kind: "dividend", currency: ccy, amount: t.quantity * t.price, title: "Dividend received", detail: `${money(t.price, ccy)}/sh × ${num(t.quantity, 4)}` });
    }
  }
  for (const sym of Object.keys(historyBySymbol)) {
    historyBySymbol[sym].sort((a, b) => b.date.localeCompare(a.date));
  }

  const closed = computed
    .filter((o) => !o.isOpen)
    .sort((a, b) => b.last_action_at.localeCompare(a.last_action_at));

  return (
    <main className="min-h-screen bg-gradient-to-b from-slate-50 to-slate-100 text-slate-800">
      <header className="border-b border-slate-800 bg-slate-900 text-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3.5">
          <div className="flex items-center gap-2.5">
            <BrandMark className="h-8 w-8" />
            <span className="text-lg font-semibold tracking-tight">Options income</span>
          </div>
          <nav className="flex items-center gap-1 text-sm">
            <Link href="/dashboard" className="rounded-lg px-3 py-1.5 text-slate-300 hover:bg-white/10">Overview</Link>
            <Link href="/dashboard/dividends" className="rounded-lg px-3 py-1.5 text-slate-300 hover:bg-white/10">Dividends</Link>
            <span className="rounded-lg bg-white/10 px-3 py-1.5 font-medium">Options</span>
            <Link href="/dashboard/options/finder" className="rounded-lg px-3 py-1.5 text-slate-300 hover:bg-white/10">Put finder</Link>
            <Link href="/dashboard/broker" className="rounded-lg px-3 py-1.5 text-slate-300 hover:bg-white/10">Brokers</Link>
          </nav>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-6 py-8">
        <div className="mb-2 flex justify-end">
          <PricesAsOf asOf={oldestPriceAsOf(positions)} />
        </div>
        {/* Page intro */}
        <div className="mb-4">
          <h1 className="font-display text-3xl font-medium tracking-tight text-slate-900">Your options income</h1>
          <p className="mt-1 text-sm text-slate-500">
            Every option you&apos;ve sold, the income it&apos;s earned, and anything that needs your eye,
            in plain numbers.
          </p>
        </div>

        {/* Cockpit tiles */}
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <Tile
            label="Total income"
            hint="All the cash you've earned from options premium plus dividends, in your base currency."
            value={money(totalIncome, base)}
            sub={`${money(dividendsReceived, base)} dividends · ${money(totals.premiumIncome, base)} premium`}
            accent
          />
          <Tile
            label="Premium earned"
            hint="Cash you kept from selling options. Green the moment you sell. It's yours to keep."
            value={money(totals.premiumIncome, base)}
            sub={`${money(totals.openPremium, base)} from still-open trades`}
          />
          <Tile
            label="Return per year"
            hint="Your average annualized return on the cash tied up as collateral. A yardstick, not a promise."
            value={totals.avgAnnualizedRoC != null ? pct(totals.avgAnnualizedRoC) : "-"}
            sub={`on ${money(totals.totalCollateral, base)} set aside`}
          />
          <Tile
            label="Expiring soon"
            hint="Open options expiring within 7 days, the ones most likely to need action."
            value={String(totals.expiringCount)}
            sub={`next 7 days · ${money(totals.expiringPremium, base)} premium${totals.nakedCount ? ` · ${totals.nakedCount} uncovered` : ""}`}
          />
        </div>

        <p className="mt-3 text-xs text-slate-400">
          For tracking only. Snowfolio never tells you what to trade. Premium is counted once, as income.
          {costBasisReduction > 0 && (
            <> If you think of it as lowering your cost, the {money(costBasisReduction, base)} of premium on
            shares you still hold has effectively shaved that much off what those shares cost you.</>
          )}
        </p>

        {attention.length > 0 && (
          <section className="mt-6 rounded-2xl border border-amber-200 bg-amber-50/40 p-5">
            <h2 className="mb-3 text-base font-semibold text-slate-800">Needs attention</h2>
            <ul className="space-y-2 text-sm">
              {attention.map((a, i) => (
                <li key={i} className="flex items-center gap-2">
                  <span className={`h-2 w-2 shrink-0 rounded-full ${a.severity === "warn" ? "bg-amber-500" : "bg-sky-400"}`} />
                  <span className="text-slate-700">{a.detail}</span>
                  <span className="ml-auto shrink-0 text-xs text-slate-400">{a.date}</span>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-xs text-slate-400">
              Turn on email alerts below to get these before you open the app.
            </p>
          </section>
        )}

        {/* Notification settings */}
        <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-5">
          <h2 className="mb-1 text-base font-semibold">Notifications</h2>
          <p className="mb-4 text-xs text-slate-400">
            Optional emails: assignment, expiry, and ex-dividend heads-ups, plus a weekly income digest.
          </p>
          <NotificationSettings initial={notifPrefs} />
        </section>

        <div className="mt-8 grid gap-6 lg:grid-cols-3">
          {/* Open positions */}
          <section className="lg:col-span-2 rounded-2xl border border-slate-200 bg-white p-5 shadow-soft">
            <h2 className="mb-1 text-base font-semibold">Open trades</h2>
            <p className="mb-4 text-xs text-slate-400">Options you&apos;ve sold that haven&apos;t expired or been closed yet.</p>
            {open.length === 0 ? (
              <p className="py-10 text-center text-sm text-slate-400">
                No open options right now. Sell a put or covered call and it&apos;ll appear here, or log one on the right →
              </p>
            ) : (
              <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-[11px] uppercase tracking-wide text-slate-400">
                    <tr>
                      <th className="pb-2 pr-2">Contract</th>
                      <th className="px-2 pb-2 text-right" title="How many contracts (1 contract = 100 shares).">Contracts</th>
                      <th className="px-2 pb-2 text-right" title="Cash you kept for selling this option.">Income</th>
                      <th className="px-2 pb-2 text-right" title="Cash set aside to back this trade: the strike × 100 for a put, or the shares' value for a covered call.">Cash set aside</th>
                      <th className="px-2 pb-2 text-right" title="Annualized return on the cash set aside. A yardstick, not a promise.">Return / yr</th>
                      <th className="px-2 pb-2 text-right" title="Days until the option expires.">Days left</th>
                      <th className="px-2 pb-2 text-right" title="Cushion: how far today's price sits from the strike. More cushion = less likely to be assigned.">Cushion</th>
                      <th className="px-2 pb-2 text-right">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {open.map((o) => (
                      <tr key={`${o.instrument_id}-${o.option_type}-${o.strike}-${o.expiration}`} className="border-t border-slate-100 hover:bg-slate-50/60">
                        <td className="py-2.5 pr-2">
                          <div className="font-medium text-slate-900">
                            {o.symbol} {money(o.strike, o.currency)} {o.option_type === "put" ? "Put" : "Call"}
                          </div>
                          <div className="mt-0.5 flex items-center gap-1.5 text-xs text-slate-400">
                            <span>exp {o.expiration}</span>
                            <Badge kind={o.covered ? "covered" : o.naked ? "naked" : "secured"} />
                          </div>
                        </td>
                        <td className="whitespace-nowrap px-2 py-2.5 text-right tabular-nums">{o.contracts}</td>
                        <td className="whitespace-nowrap px-2 py-2.5 text-right tabular-nums font-medium text-emerald-600">{money(o.premiumCollected, o.currency)}</td>
                        <td className="whitespace-nowrap px-2 py-2.5 text-right tabular-nums text-slate-500">{money(o.collateral, o.currency)}</td>
                        <td className="whitespace-nowrap px-2 py-2.5 text-right tabular-nums">{o.annualizedRoC != null ? pct(o.annualizedRoC) : "-"}</td>
                        <td className="whitespace-nowrap px-2 py-2.5 text-right tabular-nums">{o.dte}d</td>
                        <td className="whitespace-nowrap px-2 py-2.5 text-right tabular-nums text-slate-500">
                          {o.distanceToStrikePct != null ? pct(o.distanceToStrikePct) : "-"}
                        </td>
                        <td className="py-2.5 pl-2 text-right">
                          <StatusPill status={o.status} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-400">
                <span><Badge kind="covered" /> you own the shares behind it</span>
                <span><Badge kind="secured" /> backed by cash</span>
                <span><Badge kind="naked" /> not backed by shares</span>
              </div>
              </>
            )}

            {closed.length > 0 && (
              <>
                <h3 className="mb-1 mt-8 text-sm font-semibold text-slate-500">Finished trades</h3>
                <p className="mb-2 text-xs text-slate-400">Closed, expired, or assigned, with the income each one kept.</p>
                <ul className="divide-y divide-slate-100 text-sm">
                  {closed.slice(0, 12).map((o) => (
                    <li key={`${o.instrument_id}-${o.option_type}-${o.strike}-${o.expiration}`} className="flex items-center justify-between py-2">
                      <div>
                        <span className="font-medium text-slate-700">
                          {o.symbol} {money(o.strike, o.currency)} {o.option_type === "put" ? "Put" : "Call"}
                        </span>
                        <span className="ml-2 text-xs text-slate-400">{o.expiration}</span>
                      </div>
                      <span className={`tabular-nums font-medium ${o.premiumCollected >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
                        {money(o.premiumCollected, o.currency)}
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>

          {/* Add option */}
          <section className="space-y-6">
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-soft">
              <h2 className="mb-3 text-base font-semibold">Log an option</h2>
              <AddOptionForm portfolios={portfolios} />
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-5 text-xs text-slate-500 shadow-soft">
              <h3 className="mb-2 text-sm font-semibold text-slate-700">Good to know</h3>
              <ul className="space-y-1.5">
                <li>• The <strong>premium</strong> is yours to keep the moment you sell. It counts as income right away.</li>
                <li>• <strong>Return / yr</strong> scales that income up to a yearly rate, so short and long trades compare fairly.</li>
                <li>• A call is <strong>Covered</strong> when you own the 100 shares behind each contract, otherwise it&apos;s <strong>uncovered</strong>.</li>
                <li>• If a put gets <strong>assigned</strong>, we add the share purchase for you automatically.</li>
              </ul>
            </div>
          </section>
        </div>

        {premiumSeries.length > 0 && (
          <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-soft">
            <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold">Premium income over time</h2>
                <p className="mt-0.5 text-xs text-slate-400">
                  Net option premium you collected each month (credits from selling, minus buy-to-close and rolls).
                </p>
              </div>
              <div className="flex gap-5 text-right">
                <div>
                  <div className="text-[11px] uppercase tracking-wide text-slate-400">This year</div>
                  <div className="text-lg font-bold tabular-nums text-emerald-600">{money(premYtd, base)}</div>
                </div>
                <div>
                  <div className="text-[11px] uppercase tracking-wide text-slate-400">All-time</div>
                  <div className="text-lg font-bold tabular-nums text-slate-900">{money(premAllTime, base)}</div>
                </div>
                <div>
                  <div className="text-[11px] uppercase tracking-wide text-slate-400">Avg / month</div>
                  <div className="text-lg font-bold tabular-nums text-slate-900">{money(avgPerMonth, base)}</div>
                </div>
              </div>
            </div>
            <MonthlyPremiumChart data={premiumSeries} currency={base} />
          </section>
        )}

        {wheels.length > 0 && (
          <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-soft">
            <h2 className="text-base font-semibold">By stock</h2>
            <p className="mb-4 text-xs text-slate-400">
              Everything you&apos;ve earned on each stock (option premium, dividends, and stock gains) added up
              into one total, with a rough yearly return. <strong>Click any row</strong> to see its full history.
            </p>
            <WheelCycles wheels={wheels} history={historyBySymbol} base={base} />
            <p className="mt-3 text-xs text-slate-400">
              Return per year is a rough yardstick (total earned ÷ cash tied up, scaled to a year), for
              tracking, not a projection.
            </p>
          </section>
        )}
      </div>
    </main>
  );
}

function Tile({
  label,
  value,
  sub,
  hint,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  hint?: string;
  accent?: boolean;
}) {
  return (
    <div className={`rounded-2xl border p-4 shadow-soft ${accent ? "border-indigo-200 bg-gradient-to-br from-indigo-50 to-white" : "border-slate-200 bg-white"}`}>
      <div className="flex items-center gap-1 text-[11px] font-medium uppercase tracking-wide text-slate-400">
        {label}
        {hint && (
          <span title={hint} className="cursor-help text-slate-300" aria-label={hint}>ⓘ</span>
        )}
      </div>
      <div className="mt-1.5 text-2xl font-bold tracking-tight text-slate-900">{value}</div>
      {sub && <div className="mt-0.5 text-xs font-medium text-slate-500">{sub}</div>}
    </div>
  );
}

function Badge({ kind }: { kind: "covered" | "naked" | "secured" }) {
  const map = {
    covered: { text: "Covered", cls: "bg-emerald-50 text-emerald-700", hint: "You own the 100 shares per contract behind this call." },
    naked: { text: "Uncovered", cls: "bg-amber-50 text-amber-700", hint: "You don't own the shares behind this call, so higher risk if it's assigned." },
    secured: { text: "Cash-backed", cls: "bg-slate-100 text-slate-600", hint: "Backed by the cash to buy the shares if the put is assigned." },
  } as const;
  const b = map[kind];
  return <span title={b.hint} className={`cursor-help rounded-full px-1.5 py-0.5 text-[10px] font-medium ${b.cls}`}>{b.text}</span>;
}

function StatusPill({ status }: { status: ComputedOption["status"] }) {
  const cls =
    status === "may_be_assigned"
      ? "bg-amber-50 text-amber-700"
      : status === "expired"
        ? "bg-slate-100 text-slate-500"
        : "bg-emerald-50 text-emerald-700";
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>{statusLabel(status)}</span>;
}
