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
} from "@/lib/options";
import { computeWheels, type WheelPosition, type WheelRow, type WheelEvent } from "@/lib/options/wheel";
import { computeRealizedLots, summarizeRealized, type LedgerTx } from "@/lib/tax/realized";
import AddOptionForm from "@/components/AddOptionForm";
import WheelCycles from "@/components/WheelCycles";
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

  const [{ data: optRows }, { data: posRows }, { data: pfList }, { data: ledgerRows }, { data: optTxnRows }, notifPrefs] = await Promise.all([
    supabase.from("option_positions").select("*").order("expiration"),
    supabase.from("positions").select(
      "symbol, currency, shares, avg_cost, last_price, price_as_of, div_paid, option_premium, next_dividend_date, next_dividend_per_share, annual_div_per_share, div_frequency"
    ),
    supabase.from("portfolios").select("id, name").order("created_at"),
    supabase.from("transactions").select("type, quantity, price, fees, currency, executed_at, instruments(symbol)"),
    supabase.from("option_transactions").select("action, option_type, strike, expiration, contracts, premium, fee, currency, trade_date, instruments(symbol)"),
    getNotificationPrefs(),
  ]);

  const rawOptions = (optRows ?? []) as OptionPositionRow[];
  const positions = (posRows ?? []) as PositionLite[];
  const portfolios = (pfList ?? []) as { id: string; name: string }[];
  const ledger = (ledgerRows ?? []) as LedgerRow[];
  const optTxns = (optTxnRows ?? []) as OptTxnRow[];

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

        {wheels.length > 0 && (
          <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-base font-semibold">Wheel cycles</h2>
            <p className="mb-4 text-xs text-slate-400">
              Each name&apos;s whole wheel in one line — premium, dividends, and realized stock P/L rolled
              together, with its current phase and a blended return annualized over the capital it tied up.
              Click a ticker to expand its full history since inception.
            </p>
            <WheelCycles wheels={wheels} history={historyBySymbol} base={base} />
            <p className="mt-3 text-xs text-slate-400">
              Annualized return is total profit ÷ capital at risk × 365 ÷ days active — a rough blended
              yardstick across the whole cycle, not a projection. Informational only.
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
