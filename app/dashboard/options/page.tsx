import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { ensurePortfolio } from "../actions";
import { getRates } from "@/lib/marketdata";
import { money, pct, num } from "@/lib/format";
import {
  computeOption,
  computeOptionTotals,
  statusLabel,
  type OptionPositionRow,
  type ComputedOption,
  type AttentionItem,
  type UnderlyingIncome,
} from "@/lib/options";
import AddOptionForm from "@/components/AddOptionForm";
import PricesAsOf, { oldestPriceAsOf } from "@/components/PricesAsOf";
import NotificationSettings from "@/components/NotificationSettings";
import { getNotificationPrefs } from "./actions";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type PositionLite = {
  symbol: string;
  currency: string;
  shares: number;
  last_price: number | null;
  price_as_of: string | null;
  div_paid: number | null;
  option_premium: number | null;
  next_dividend_date: string | null;
  next_dividend_per_share: number | null;
  annual_div_per_share: number | null;
  div_frequency: number | null;
};

export default async function OptionsPage() {
  const supabase = await createClient();
  const portfolio = await ensurePortfolio();
  const base = portfolio.base_currency || "USD";

  const [{ data: optRows }, { data: posRows }, { data: pfList }, notifPrefs] = await Promise.all([
    supabase.from("option_positions").select("*").order("expiration"),
    supabase.from("positions").select(
      "symbol, currency, shares, last_price, price_as_of, div_paid, option_premium, next_dividend_date, next_dividend_per_share, annual_div_per_share, div_frequency"
    ),
    supabase.from("portfolios").select("id, name").order("created_at"),
    getNotificationPrefs(),
  ]);

  const rawOptions = (optRows ?? []) as OptionPositionRow[];
  const positions = (posRows ?? []) as PositionLite[];
  const portfolios = (pfList ?? []) as { id: string; name: string }[];

  // FX across every currency in play (options + equity positions).
  const currencies = [...rawOptions.map((o) => o.currency), ...positions.map((p) => p.currency)];
  const rates = await getRates(currencies, base);
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
  const attention: AttentionItem[] = [];
  for (const o of open) {
    if (o.status === "may_be_assigned") {
      attention.push({
        kind: "assignment", symbol: o.symbol, severity: "warn", date: o.expiration,
        detail: `${o.symbol} ${money(o.strike, o.currency)} ${o.option_type} is in-the-money with ${o.dte}d left — may be assigned`,
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

  // O2 — income by underlying (single-name wheel story): option premium + dividends per ticker,
  // limited to names with option activity so it stays an options view, not a dividend dump.
  const incomeMap = new Map<string, UnderlyingIncome>();
  const initInc = (symbol: string): UnderlyingIncome => {
    let e = incomeMap.get(symbol);
    if (!e) {
      e = { symbol, premium: 0, dividends: 0, total: 0, shares: 0, openPuts: 0, openCalls: 0 };
      incomeMap.set(symbol, e);
    }
    return e;
  };
  for (const o of computed) {
    const e = initInc(o.symbol);
    e.premium += o.premiumCollected * fx(o.currency);
    if (o.isOpen && o.option_type === "put") e.openPuts += o.contracts;
    if (o.isOpen && o.option_type === "call") e.openCalls += o.contracts;
  }
  for (const p of positions) {
    if (!p.symbol || !incomeMap.has(p.symbol)) continue; // only annotate option-active names
    const e = initInc(p.symbol);
    e.dividends += (p.div_paid ?? 0) * fx(p.currency);
    e.shares += p.shares;
  }
  const incomeByUnderlying = [...incomeMap.values()]
    .map((e) => ({ ...e, total: e.premium + e.dividends }))
    .sort((a, b) => b.total - a.total);
  const closed = computed
    .filter((o) => !o.isOpen)
    .sort((a, b) => b.last_action_at.localeCompare(a.last_action_at));

  return (
    <main className="min-h-screen bg-gradient-to-b from-slate-50 to-slate-100 text-slate-800">
      <header className="border-b border-slate-800 bg-slate-900 text-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3.5">
          <div className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-sky-400 to-indigo-500" />
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
        {/* Cockpit tiles */}
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <Tile
            label={`Total income (${base})`}
            value={money(totalIncome, base)}
            sub={`${money(dividendsReceived, base)} divs · ${money(totals.premiumIncome, base)} premium`}
            accent
          />
          <Tile label="Premium collected" value={money(totals.premiumIncome, base)} sub={`${money(totals.openPremium, base)} on open`} />
          <Tile
            label="Avg annualized RoC"
            value={totals.avgAnnualizedRoC != null ? pct(totals.avgAnnualizedRoC) : "—"}
            sub={`${money(totals.totalCollateral, base)} collateral at work`}
          />
          <Tile
            label="Expiring ≤ 7 days"
            value={String(totals.expiringCount)}
            sub={`${money(totals.expiringPremium, base)} premium${totals.nakedCount ? ` · ${totals.nakedCount} naked` : ""}`}
          />
        </div>

        <p className="mt-3 text-xs text-slate-400">
          Informational only — Snowfolio tracks what you’ve done; it never recommends a trade.
          Premium counts once, as income here — your equity cost basis stays the true price you paid.
          If you prefer the seller’s lens, {money(costBasisReduction, base)} of premium on shares you
          currently hold would lower your <em>effective</em> basis by that much.
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
            Optional emails — assignment/expiry/ex-dividend heads-ups, and a weekly income digest.
          </p>
          <NotificationSettings initial={notifPrefs} />
        </section>

        <div className="mt-8 grid gap-6 lg:grid-cols-3">
          {/* Open positions */}
          <section className="lg:col-span-2 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="mb-4 text-base font-semibold">Open positions</h2>
            {open.length === 0 ? (
              <p className="py-10 text-center text-sm text-slate-400">
                No open options yet. Log a sold put or covered call on the right →
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-[11px] uppercase tracking-wide text-slate-400">
                    <tr>
                      <th className="pb-2">Contract</th>
                      <th className="pb-2 text-right">Qty</th>
                      <th className="pb-2 text-right">Premium</th>
                      <th className="pb-2 text-right">Collateral</th>
                      <th className="pb-2 text-right">Ann. RoC</th>
                      <th className="pb-2 text-right">DTE</th>
                      <th className="pb-2 text-right">Δ strike</th>
                      <th className="pb-2 text-right">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {open.map((o) => (
                      <tr key={`${o.instrument_id}-${o.option_type}-${o.strike}-${o.expiration}`} className="border-t border-slate-100 hover:bg-slate-50/60">
                        <td className="py-2.5">
                          <div className="font-medium text-slate-900">
                            {o.symbol} {money(o.strike, o.currency)} {o.option_type === "put" ? "Put" : "Call"}
                          </div>
                          <div className="mt-0.5 flex items-center gap-1.5 text-xs text-slate-400">
                            <span>{o.expiration}</span>
                            <Badge kind={o.covered ? "covered" : o.naked ? "naked" : "secured"} />
                          </div>
                        </td>
                        <td className="py-2.5 text-right tabular-nums">{o.contracts}</td>
                        <td className="py-2.5 text-right tabular-nums font-medium text-emerald-600">{money(o.premiumCollected, o.currency)}</td>
                        <td className="py-2.5 text-right tabular-nums text-slate-500">{money(o.collateral, o.currency)}</td>
                        <td className="py-2.5 text-right tabular-nums">{o.annualizedRoC != null ? pct(o.annualizedRoC) : "—"}</td>
                        <td className="py-2.5 text-right tabular-nums">{o.dte}</td>
                        <td className="py-2.5 text-right tabular-nums text-slate-500">
                          {o.distanceToStrikePct != null ? pct(o.distanceToStrikePct) : "—"}
                        </td>
                        <td className="py-2.5 text-right">
                          <StatusPill status={o.status} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {closed.length > 0 && (
              <>
                <h3 className="mb-2 mt-8 text-sm font-semibold text-slate-500">Closed / expired</h3>
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
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="mb-3 text-base font-semibold">Log an option</h2>
              <AddOptionForm portfolios={portfolios} />
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-5 text-xs text-slate-500 shadow-sm">
              <h3 className="mb-2 text-sm font-semibold text-slate-700">How income is counted</h3>
              <ul className="space-y-1.5">
                <li>• Premium is realized income the moment you sell to open.</li>
                <li>• <strong>Annualized RoC</strong> = premium ÷ collateral × 365 ÷ days to expiry.</li>
                <li>• A short call is <strong>Covered</strong> when you hold ≥ 100 shares per contract, else flagged <strong>Naked</strong>.</li>
                <li>• <strong>Assigned</strong> a put? We add the share purchase at the strike automatically.</li>
              </ul>
            </div>
          </section>
        </div>

        {incomeByUnderlying.length > 0 && (
          <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-base font-semibold">Income by underlying</h2>
            <p className="mb-4 text-xs text-slate-400">
              Each wheel’s full income on one name — option premium plus dividends earned while you held it.
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-[11px] uppercase tracking-wide text-slate-400">
                  <tr>
                    <th className="pb-2">Underlying</th>
                    <th className="pb-2 text-right">Premium</th>
                    <th className="pb-2 text-right">Dividends</th>
                    <th className="pb-2 text-right">Total income</th>
                    <th className="pb-2 text-right">State</th>
                  </tr>
                </thead>
                <tbody>
                  {incomeByUnderlying.map((e) => (
                    <tr key={e.symbol} className="border-t border-slate-100">
                      <td className="py-2.5 font-medium text-slate-900">{e.symbol}</td>
                      <td className="py-2.5 text-right tabular-nums text-emerald-600">{money(e.premium, base)}</td>
                      <td className="py-2.5 text-right tabular-nums text-slate-500">{money(e.dividends, base)}</td>
                      <td className="py-2.5 text-right tabular-nums font-semibold">{money(e.total, base)}</td>
                      <td className="py-2.5 text-right text-xs text-slate-500">
                        {e.shares > 0 ? `${num(e.shares, 0)} sh` : "no shares"}
                        {e.openPuts > 0 ? ` · ${e.openPuts}P` : ""}
                        {e.openCalls > 0 ? ` · ${e.openCalls}C` : ""}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
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
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: boolean;
}) {
  return (
    <div className={`rounded-2xl border p-4 shadow-sm ${accent ? "border-indigo-200 bg-gradient-to-br from-indigo-50 to-white" : "border-slate-200 bg-white"}`}>
      <div className="text-[11px] font-medium uppercase tracking-wide text-slate-400">{label}</div>
      <div className="mt-1.5 text-2xl font-bold tracking-tight text-slate-900">{value}</div>
      {sub && <div className="mt-0.5 text-xs font-medium text-slate-500">{sub}</div>}
    </div>
  );
}

function Badge({ kind }: { kind: "covered" | "naked" | "secured" }) {
  const map = {
    covered: { text: "Covered", cls: "bg-emerald-50 text-emerald-700" },
    naked: { text: "Naked", cls: "bg-amber-50 text-amber-700" },
    secured: { text: "Cash-secured", cls: "bg-slate-100 text-slate-600" },
  } as const;
  const b = map[kind];
  return <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${b.cls}`}>{b.text}</span>;
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
