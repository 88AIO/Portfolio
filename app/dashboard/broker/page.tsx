import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { ensurePortfolio } from "../actions";
import { isBrokerSyncConfigured, isBrokerSyncOwner } from "@/lib/brokersync";
import { timeAgo } from "@/lib/format";
import BrokerConnect from "@/components/BrokerConnect";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type BrokerAccountRow = {
  id: string;
  brokerage_name: string | null;
  account_number: string | null;
  last_synced_at: string | null;
};

export default async function BrokerPage() {
  const supabase = await createClient();
  await ensurePortfolio(); // ensures signed-in (redirects to /login otherwise)
  const { data: { user } } = await supabase.auth.getUser();
  const configured = isBrokerSyncConfigured();
  const isOwner = isBrokerSyncOwner(user?.email);

  const { data: accounts } = await supabase
    .from("broker_accounts")
    .select("id, brokerage_name, account_number, last_synced_at")
    .order("created_at", { ascending: true });
  const rows = (accounts ?? []) as BrokerAccountRow[];

  return (
    <main className="min-h-screen bg-slate-50 text-slate-800">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-2">
            <div className="h-7 w-7 rounded-full bg-gradient-to-br from-sky-400 to-indigo-500" />
            <span className="text-lg font-semibold">Brokerages</span>
          </div>
          <Link href="/dashboard" className="text-sm text-indigo-600 hover:underline">
            ← Back to dashboard
          </Link>
        </div>
      </header>

      <div className="mx-auto max-w-3xl px-6 py-8">
        <section className="rounded-2xl border border-slate-200 bg-white p-6">
          <h2 className="font-semibold">Brokerage sync</h2>
          <p className="mt-1 mb-4 text-sm text-slate-500">
            Read-only sync via SnapTrade — your brokerage credentials never touch Snowfolio.
          </p>

          {configured && !isOwner ? (
            <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-700">
              Brokerage auto-sync isn’t available on your account yet. It currently connects a
              single owner’s brokerage; per-user connections are on the roadmap. You can still add
              holdings manually or import a CSV from the dashboard.
            </p>
          ) : configured && isOwner ? (
            <div className="space-y-4">
              <p className="text-sm text-slate-500">
                Connect or manage brokerages in your{" "}
                <a
                  href="https://dashboard.snaptrade.com/home"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-indigo-600 hover:underline"
                >
                  SnapTrade dashboard ↗
                </a>
                , then pull them in here.
              </p>
              <BrokerConnect />
            </div>
          ) : (
            <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-700">
              Broker sync isn’t set up yet. Add your SnapTrade API keys
              (<span className="font-mono">SNAPTRADE_CLIENT_ID</span> /{" "}
              <span className="font-mono">SNAPTRADE_CONSUMER_KEY</span>) to enable it.
            </p>
          )}

          {rows.length > 0 && (
            <ul className="mt-6 divide-y divide-slate-100 text-sm">
              {rows.map((a) => (
                <li key={a.id} className="flex items-center justify-between py-3">
                  <div>
                    <div className="font-medium">{a.brokerage_name ?? "Brokerage"}</div>
                    <div className="text-xs text-slate-400">
                      {a.account_number ? `••••${a.account_number.slice(-4)}` : "account"}
                    </div>
                  </div>
                  <div className="text-xs text-slate-400">
                    {a.last_synced_at ? `synced ${timeAgo(a.last_synced_at)}` : "not synced yet"}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </main>
  );
}
