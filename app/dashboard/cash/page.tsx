import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { ensurePortfolio } from "../actions";
import { getRates } from "@/lib/marketdata";
import { money, timeAgo } from "@/lib/format";
import AddCashEntryForm from "@/components/AddCashEntryForm";
import { deleteCashEntry } from "./actions";

export const dynamic = "force-dynamic";

type BrokerAcct = {
  portfolio_id: string | null;
  brokerage_name: string | null;
  account_number: string | null;
  cash_balance: number | null;
  currency: string | null;
  is_cash: boolean | null;
  account_category: string | null;
  last_synced_at: string | null;
};

type LedgerRow = {
  id: string;
  portfolio_id: string;
  entry_date: string;
  description: string | null;
  amount: number;
  currency: string;
  source: string;
};

export default async function CashPage() {
  const supabase = await createClient();
  const portfolio = await ensurePortfolio();
  const base = portfolio.base_currency || "USD";

  const [{ data: accts }, { data: pfList }, { data: ledger }] = await Promise.all([
    supabase
      .from("broker_accounts")
      .select("portfolio_id, brokerage_name, account_number, cash_balance, currency, is_cash, account_category, last_synced_at"),
    supabase.from("portfolios").select("id, name").order("created_at"),
    supabase.from("cash_ledger").select("*").order("entry_date", { ascending: false }).limit(100),
  ]);

  const accounts = (accts ?? []) as BrokerAcct[];
  const portfolios = (pfList ?? []) as { id: string; name: string }[];
  const entries = (ledger ?? []) as LedgerRow[];
  const pfName = new Map(portfolios.map((p) => [p.id, p.name] as [string, string]));

  // Cash accounts = anything flagged as cash/deposit or carrying a reported balance.
  const cashAccounts = accounts
    .filter((a) => a.is_cash || a.cash_balance != null)
    .sort((a, b) => (b.cash_balance ?? 0) - (a.cash_balance ?? 0));

  const currencies = [
    ...cashAccounts.map((a) => a.currency ?? "USD"),
    ...entries.map((e) => e.currency),
  ];
  const rates = await getRates(currencies, base);
  const fx = (ccy: string) => rates[ccy] ?? 1;

  const syncedCash = cashAccounts.reduce((s, a) => s + (a.cash_balance ?? 0) * fx(a.currency ?? "USD"), 0);
  const manualNet = entries.reduce((s, e) => s + e.amount * fx(e.currency), 0);

  // Prefer cash-account portfolios in the ledger's account picker.
  const cashPfIds = new Set(cashAccounts.map((a) => a.portfolio_id).filter(Boolean) as string[]);
  const ledgerPortfolios = [
    ...portfolios.filter((p) => cashPfIds.has(p.id)),
    ...portfolios.filter((p) => !cashPfIds.has(p.id)),
  ];

  return (
    <main className="min-h-screen bg-gradient-to-b from-slate-50 to-slate-100 text-slate-800">
      <header className="border-b border-slate-800 bg-slate-900 text-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3.5">
          <div className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-sky-400 to-indigo-500" />
            <span className="text-lg font-semibold tracking-tight">Cash &amp; ledger</span>
          </div>
          <nav className="flex items-center gap-1 text-sm">
            <Link href="/dashboard" className="rounded-lg px-3 py-1.5 text-slate-300 hover:bg-white/10">Overview</Link>
            <Link href="/dashboard/dividends" className="rounded-lg px-3 py-1.5 text-slate-300 hover:bg-white/10">Dividends</Link>
            <Link href="/dashboard/options" className="rounded-lg px-3 py-1.5 text-slate-300 hover:bg-white/10">Options</Link>
            <span className="rounded-lg bg-white/10 px-3 py-1.5 font-medium">Cash</span>
            <Link href="/dashboard/broker" className="rounded-lg px-3 py-1.5 text-slate-300 hover:bg-white/10">Brokers</Link>
          </nav>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-6 py-8">
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
          <Tile label={`Synced cash (${base})`} value={money(syncedCash, base)} accent />
          <Tile label="Manual ledger net" value={money(manualNet, base)} />
          <Tile label="Cash accounts" value={String(cashAccounts.length)} />
        </div>

        <div className="mt-8 grid gap-6 lg:grid-cols-3">
          <section className="lg:col-span-2 space-y-6">
            {/* Synced cash accounts */}
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="mb-4 text-base font-semibold">Cash accounts</h2>
              {cashAccounts.length === 0 ? (
                <p className="py-8 text-center text-sm text-slate-400">
                  No cash or bank accounts synced yet. Connect one in the SnapTrade dashboard, then hit Sync.
                </p>
              ) : (
                <ul className="divide-y divide-slate-100 text-sm">
                  {cashAccounts.map((a, i) => (
                    <li key={i} className="flex items-center justify-between py-2.5">
                      <div>
                        <div className="font-medium text-slate-900">
                          {a.portfolio_id ? pfName.get(a.portfolio_id) ?? a.brokerage_name : a.brokerage_name}
                        </div>
                        <div className="text-xs text-slate-400">
                          {a.brokerage_name}
                          {a.account_category ? ` · ${a.account_category.toLowerCase()}` : ""}
                          {a.last_synced_at ? ` · synced ${timeAgo(a.last_synced_at)}` : ""}
                        </div>
                      </div>
                      <div className="text-right font-medium tabular-nums">
                        {a.cash_balance != null ? money(a.cash_balance, a.currency ?? base) : <span className="text-slate-300">—</span>}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Manual ledger */}
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="mb-1 text-base font-semibold">Ledger</h2>
              <p className="mb-4 text-xs text-slate-400">
                Manual cash movements you record — deposits, withdrawals, interest, fees.
              </p>
              {entries.length === 0 ? (
                <p className="py-8 text-center text-sm text-slate-400">No entries yet. Add one on the right →</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="text-left text-[11px] uppercase tracking-wide text-slate-400">
                      <tr>
                        <th className="pb-2">Date</th>
                        <th className="pb-2">Account</th>
                        <th className="pb-2">Description</th>
                        <th className="pb-2 text-right">Amount</th>
                        <th className="pb-2"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {entries.map((e) => (
                        <tr key={e.id} className="border-t border-slate-100">
                          <td className="py-2.5 text-slate-500">{e.entry_date}</td>
                          <td className="py-2.5">{pfName.get(e.portfolio_id) ?? "—"}</td>
                          <td className="py-2.5 text-slate-600">{e.description ?? ""}</td>
                          <td className={`py-2.5 text-right tabular-nums font-medium ${e.amount >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
                            {money(e.amount, e.currency)}
                          </td>
                          <td className="py-2.5 text-right">
                            <form action={deleteCashEntry}>
                              <input type="hidden" name="id" value={e.id} />
                              <button aria-label="Delete entry" className="text-xs text-slate-300 hover:text-rose-500" title="Delete">✕</button>
                            </form>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </section>

          <section className="space-y-6">
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="mb-3 text-base font-semibold">Add ledger entry</h2>
              <AddCashEntryForm portfolios={ledgerPortfolios} />
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-5 text-xs text-slate-500 shadow-sm">
              Bank &amp; deposit accounts (like Chase) are tracked here as cash, kept out of your stock holdings
              and allocation so they don’t distort performance. Synced balances refresh on each broker sync.
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}

function Tile({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className={`rounded-2xl border p-4 shadow-sm ${accent ? "border-indigo-200 bg-gradient-to-br from-indigo-50 to-white" : "border-slate-200 bg-white"}`}>
      <div className="text-[11px] font-medium uppercase tracking-wide text-slate-400">{label}</div>
      <div className="mt-1.5 text-2xl font-bold tracking-tight text-slate-900">{value}</div>
    </div>
  );
}
