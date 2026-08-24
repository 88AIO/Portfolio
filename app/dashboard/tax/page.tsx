import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { ensurePortfolio } from "../actions";
import { fetchAll } from "@/lib/supabase/paginate";
import { getCachedRates } from "@/lib/fx";
import { money } from "@/lib/format";
import {
  computeRealizedLots,
  summarizeRealized,
  lotsInYear,
  realizedYears,
  type LedgerTx,
} from "@/lib/tax/realized";

export const dynamic = "force-dynamic";

type TxRow = {
  type: string;
  quantity: number | null;
  price: number | null;
  fees: number | null;
  currency: string | null;
  executed_at: string | null;
  instruments: { symbol: string } | { symbol: string }[] | null;
};

type OptRow = {
  action: string;
  premium: number | null;
  contracts: number | null;
  fee: number | null;
  currency: string | null;
  trade_date: string | null;
};

function symbolOf(rel: TxRow["instruments"]): string | null {
  if (!rel) return null;
  return Array.isArray(rel) ? rel[0]?.symbol ?? null : rel.symbol;
}

// Signed premium cash for one option leg (credit on open, debit on close/roll; fees always a cost).
function legPremium(o: OptRow): number {
  const gross = (o.premium ?? 0) * (o.contracts ?? 0) * 100;
  const fee = o.fee ?? 0;
  if (o.action === "sell_to_open") return gross - fee;
  if (o.action === "buy_to_close" || o.action === "rolled") return -gross - fee;
  return -fee;
}

export default async function TaxPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const sp = await searchParams;
  const supabase = await createClient();
  const portfolio = await ensurePortfolio();
  const base = portfolio.base_currency || "USD";

  // Transactions can exceed Supabase's ~1000-row cap; page through them so FIFO realized-gain
  // matching sees the whole ledger (a truncated read would drop recent sells and misstate gains).
  const [txRows, { data: optData }] = await Promise.all([
    fetchAll<TxRow>((from, to) =>
      supabase
        .from("transactions")
        .select("type, quantity, price, fees, currency, executed_at, instruments(symbol)")
        .order("executed_at", { ascending: true })
        .order("instrument_id", { ascending: true })
        .range(from, to),
    ),
    supabase.from("option_transactions").select("action, premium, contracts, fee, currency, trade_date"),
  ]);

  const optRows = (optData ?? []) as OptRow[];

  // Build the ledger for FIFO matching (buys/sells only need a symbol).
  const ledger: LedgerTx[] = txRows
    .map((t) => ({
      symbol: symbolOf(t.instruments) ?? "",
      currency: t.currency ?? base,
      type: t.type,
      quantity: t.quantity ?? 0,
      price: t.price ?? 0,
      fees: t.fees ?? 0,
      executed_at: t.executed_at ?? "",
    }))
    .filter((t) => t.symbol && t.executed_at);

  const allLots = computeRealizedLots(ledger);
  const years = realizedYears(allLots);
  const currentYear = Number(new Date().toISOString().slice(0, 4));
  const yearParam = Number(Array.isArray(sp.year) ? sp.year[0] : sp.year);
  const year = Number.isFinite(yearParam) && yearParam > 1990 ? yearParam : years[0] ?? currentYear;

  const yearLots = lotsInYear(allLots, year);

  // FX for every currency across realized lots, dividends, and option legs.
  const currencies = [
    ...yearLots.map((l) => l.currency),
    ...txRows.map((t) => t.currency ?? base),
    ...optRows.map((o) => o.currency ?? base),
  ];
  const rates = await getCachedRates(supabase, currencies, base);
  const fx = (ccy: string) => rates[ccy] ?? 1;

  const summary = summarizeRealized(yearLots, fx);

  // Dividends received in the year (cash = quantity × price on dividend transactions).
  let dividendsYear = 0;
  for (const t of txRows) {
    if (t.type !== "dividend" || !t.executed_at) continue;
    if (t.executed_at.slice(0, 4) !== String(year)) continue;
    dividendsYear += (t.quantity ?? 0) * (t.price ?? 0) * fx(t.currency ?? base);
  }

  // Option premium realized (cash basis) in the year, by trade date.
  let optionPremiumYear = 0;
  for (const o of optRows) {
    if (!o.trade_date || o.trade_date.slice(0, 4) !== String(year)) continue;
    optionPremiumYear += legPremium(o) * fx(o.currency ?? base);
  }

  const totalIncome = summary.totalGain + dividendsYear + optionPremiumYear;

  return (
    <main className="min-h-screen bg-slate-50 text-slate-800">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-2">
            <div className="h-7 w-7 rounded-full bg-gradient-to-br from-sky-400 to-indigo-500" />
            <span className="text-lg font-semibold">Realized &amp; tax</span>
          </div>
          <Link href="/dashboard" className="text-sm text-indigo-600 hover:underline">
            ← Back to dashboard
          </Link>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-6 py-8">
        {/* Year picker */}
        <div className="mb-6 flex flex-wrap items-center gap-2">
          <span className="text-sm text-slate-500">Tax year</span>
          {(years.length ? years : [currentYear]).map((y) => (
            <Link
              key={y}
              href={`/dashboard/tax?year=${y}`}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
                y === year ? "bg-slate-900 text-white" : "border border-slate-200 text-slate-600 hover:bg-slate-100"
              }`}
            >
              {y}
            </Link>
          ))}
          <a
            href={`/api/export/realized?year=${year}`}
            download
            className="ml-auto inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            ↓ Realized gains {year} (.csv)
          </a>
        </div>

        {/* Summary */}
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <Card label={`Realized gain (${base})`} value={money(summary.totalGain, base)} tone={summary.totalGain >= 0 ? "up" : "down"} />
          <Card label="Short-term" value={money(summary.shortTermGain, base)} tone={summary.shortTermGain >= 0 ? "up" : "down"} />
          <Card label="Long-term" value={money(summary.longTermGain, base)} tone={summary.longTermGain >= 0 ? "up" : "down"} />
          <Card label="Dividends received" value={money(dividendsYear, base)} />
        </div>
        <div className="mt-4 grid grid-cols-2 gap-4 md:grid-cols-4">
          <Card label="Option premium (cash)" value={money(optionPremiumYear, base)} tone={optionPremiumYear >= 0 ? "up" : "down"} />
          <Card label={`Taxable income ${year}`} value={money(totalIncome, base)} sub="gains + dividends + premium" />
          <Card label="Proceeds" value={money(summary.proceeds, base)} />
          <Card label="Cost basis" value={money(summary.costBasis, base)} />
        </div>

        {/* Realized lots */}
        <section className="mt-8 rounded-2xl border border-slate-200 bg-white p-5">
          <h2 className="mb-4 font-semibold">Realized sales, {year} (FIFO)</h2>
          {yearLots.length === 0 ? (
            <p className="py-10 text-center text-sm text-slate-400">
              No realized sales in {year}. Sell a holding and it shows up here with its cost basis and gain.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase text-slate-400">
                  <tr>
                    <th className="pb-2">Symbol</th>
                    <th className="pb-2 text-right">Qty</th>
                    <th className="pb-2">Acquired</th>
                    <th className="pb-2">Sold</th>
                    <th className="pb-2">Term</th>
                    <th className="pb-2 text-right">Proceeds</th>
                    <th className="pb-2 text-right">Cost basis</th>
                    <th className="pb-2 text-right">Gain / loss</th>
                  </tr>
                </thead>
                <tbody>
                  {yearLots.map((l, i) => (
                    <tr key={i} className="border-t border-slate-100">
                      <td className="py-2.5 font-medium">{l.symbol}</td>
                      <td className="py-2.5 text-right tabular-nums">{l.quantity}</td>
                      <td className="py-2.5 text-slate-500">{l.openDate}</td>
                      <td className="py-2.5 text-slate-500">{l.closeDate}</td>
                      <td className="py-2.5">
                        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${l.longTerm ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>
                          {l.longTerm ? "Long" : "Short"}
                        </span>
                      </td>
                      <td className="py-2.5 text-right tabular-nums">{money(l.proceeds, l.currency)}</td>
                      <td className="py-2.5 text-right tabular-nums">{money(l.costBasis, l.currency)}</td>
                      <td className={`py-2.5 text-right tabular-nums font-medium ${l.gain >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
                        {money(l.gain, l.currency)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <p className="mt-4 max-w-3xl text-xs text-slate-400">
          Informational, not tax advice. Gains are matched <strong>FIFO</strong> (first shares bought
          are the first sold), with the long-term line drawn at a one-year hold. This does not model
          wash sales, alternate lot-relief methods, return-of-capital adjustments, or the special tax
          treatment of options. Option premium is shown on a simple cash basis. Confirm figures
          against your broker&apos;s 1099 before filing.
        </p>
      </div>
    </main>
  );
}

function Card({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "up" | "down";
}) {
  const toneClass = tone === "up" ? "text-emerald-600" : tone === "down" ? "text-rose-600" : "text-slate-900";
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="text-xs uppercase tracking-wide text-slate-400">{label}</div>
      <div className={`mt-1 text-xl font-semibold ${toneClass}`}>{value}</div>
      {sub && <div className="mt-0.5 text-xs text-slate-400">{sub}</div>}
    </div>
  );
}
