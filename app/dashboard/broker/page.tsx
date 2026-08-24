import { createClient } from "@/lib/supabase/server";
import { ensurePortfolio } from "../actions";
import DashboardNav from "@/components/DashboardNav";
import { isBrokerSyncConfigured, isBrokerSyncOwner } from "@/lib/brokersync";
import { timeAgo } from "@/lib/format";
import BrokerConnect from "@/components/BrokerConnect";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // the full trade-history import is heavy; give the sync room

type BrokerAccountRow = {
  id: string;
  brokerage_name: string | null;
  account_number: string | null;
  account_type: string | null;
  is_cash: boolean | null;
  last_synced_at: string | null;
};

// Short initials for a brokerage's avatar chip (e.g. "E-Trade" → "ET").
function initials(name: string): string {
  const words = name.replace(/[^a-zA-Z0-9 ]/g, " ").split(/\s+/).filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

// Turn a raw account-type code into friendly words.
function accountTypeLabel(t: string | null, isCash: boolean | null): string {
  if (!t) return isCash ? "Cash" : "Investment";
  const map: Record<string, string> = {
    INDIVIDUAL: "Individual", ROTHIRA: "Roth IRA", ROTH: "Roth IRA", TRADITIONALIRA: "Traditional IRA",
    IRA: "IRA", CHECKING: "Checking", SAVINGS: "Savings", CREDITCARD: "Credit card", DEFAULT: "Investment",
  };
  return map[t.toUpperCase().replace(/[\s_]/g, "")] ?? t;
}

export default async function BrokerPage() {
  const supabase = await createClient();
  await ensurePortfolio(); // ensures signed-in (redirects to /login otherwise)
  const { data: { user } } = await supabase.auth.getUser();
  const configured = isBrokerSyncConfigured();
  const isOwner = isBrokerSyncOwner(user?.email);

  const [{ data: accounts }, { count: holdingsCount }, { count: optionCount }] = await Promise.all([
    supabase
      .from("broker_accounts")
      .select("id, brokerage_name, account_number, account_type, is_cash, last_synced_at")
      .order("created_at", { ascending: true }),
    supabase.from("positions").select("*", { count: "exact", head: true }),
    supabase.from("option_transactions").select("*", { count: "exact", head: true }),
  ]);
  const rows = (accounts ?? []) as BrokerAccountRow[];
  const lastSynced = rows.reduce<string | null>((latest, a) => {
    if (!a.last_synced_at) return latest;
    return !latest || a.last_synced_at > latest ? a.last_synced_at : latest;
  }, null);

  return (
    <main className="min-h-screen bg-slate-50 text-slate-800">
      <DashboardNav active="broker" email={user?.email} />

      <div className="mx-auto max-w-3xl px-6 py-8 space-y-6">
        {/* Intro / what this does */}
        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-soft">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="font-display text-2xl font-medium tracking-tight text-slate-900">Connected brokerages</h1>
              <p className="mt-1 text-sm text-slate-500">
                Snowfolio reads your holdings and option trades directly from your brokerages, so your
                dashboard stays current on its own. It&apos;s <strong>read-only</strong>. Your login never
                touches Snowfolio, and nothing can trade on your behalf.
              </p>
            </div>
          </div>

          {/* Auto-sync + last-updated status */}
          {configured && isOwner && rows.length > 0 && (
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                Auto-syncs every night
              </span>
              {lastSynced && (
                <span className="text-xs text-slate-400">Last updated {timeAgo(lastSynced)}</span>
              )}
            </div>
          )}

          {/* At-a-glance numbers */}
          {configured && isOwner && rows.length > 0 && (
            <div className="mt-4 grid grid-cols-3 gap-3">
              <Stat label="Accounts" value={rows.length} />
              <Stat label="Holdings" value={holdingsCount ?? 0} />
              <Stat label="Option trades" value={optionCount ?? 0} />
            </div>
          )}
        </section>

        {/* Sync / setup card */}
        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-soft">
          {configured && !isOwner ? (
            <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-700">
              Brokerage auto-sync isn&apos;t available on your account yet. It currently connects a
              single owner&apos;s brokerage; per-user connections are on the roadmap. You can still add
              holdings manually or import a CSV from the dashboard.
            </p>
          ) : configured && isOwner ? (
            <div className="space-y-4">
              <div>
                <h2 className="font-semibold">Update now</h2>
                <p className="mt-1 text-sm text-slate-500">
                  It refreshes automatically each night. Tap below only if you want the latest right away.
                  New brokerages are added in your{" "}
                  <a href="https://dashboard.snaptrade.com/home" target="_blank" rel="noopener noreferrer" className="text-indigo-600 hover:underline">
                    SnapTrade dashboard ↗
                  </a>.
                </p>
              </div>
              <BrokerConnect />
            </div>
          ) : (
            <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-700">
              Broker sync isn&apos;t set up yet. Add your SnapTrade API keys
              (<span className="font-mono">SNAPTRADE_CLIENT_ID</span> /{" "}
              <span className="font-mono">SNAPTRADE_CONSUMER_KEY</span>) to enable it.
            </p>
          )}
        </section>

        {/* Account list */}
        {rows.length > 0 && (
          <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-soft">
            <h2 className="mb-1 font-semibold">Your accounts</h2>
            <p className="mb-4 text-xs text-slate-400">{rows.length} connected · each becomes its own portfolio.</p>
            <ul className="divide-y divide-slate-100">
              {rows.map((a) => {
                const name = a.brokerage_name ?? "Brokerage";
                return (
                  <li key={a.id} className="flex items-center gap-3 py-3">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#edf3ee] text-xs font-bold text-[#205d4a]">
                      {initials(name)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="font-medium text-slate-800">{name}</div>
                      <div className="text-xs text-slate-400">
                        {accountTypeLabel(a.account_type, a.is_cash)}
                        {a.account_number ? ` · ••••${a.account_number.slice(-4)}` : ""}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5 text-xs text-slate-400">
                      {a.last_synced_at ? (
                        <>
                          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                          {timeAgo(a.last_synced_at)}
                        </>
                      ) : (
                        "not synced yet"
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        )}
      </div>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-3 text-center">
      <div className="font-display text-2xl font-medium tracking-tight text-slate-900 tabular-nums">{value.toLocaleString()}</div>
      <div className="mt-0.5 text-[11px] font-medium uppercase tracking-[0.08em] text-slate-400">{label}</div>
    </div>
  );
}
