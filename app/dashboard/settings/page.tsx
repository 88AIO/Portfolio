import { getCurrentUser } from "@/lib/supabase/user";
import { ensurePortfolio, signOut } from "../actions";
import DashboardNav from "@/components/DashboardNav";
import DeleteAccountButton from "@/components/DeleteAccountButton";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  await ensurePortfolio(); // ensures signed in (redirects to /login otherwise)
  const user = await getCurrentUser();

  return (
    <main className="min-h-screen bg-slate-50 text-slate-800">
      <DashboardNav active="settings" email={user?.email} />

      <div className="mx-auto max-w-3xl space-y-6 px-6 py-8">
        <div className="mb-1">
          <h1 className="font-display text-3xl font-medium tracking-tight text-slate-900">Settings</h1>
          <p className="mt-1.5 text-sm text-slate-500">Your account, your data, and your controls.</p>
        </div>

        {/* Account */}
        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-soft">
          <h2 className="text-base font-semibold">Account</h2>
          <p className="mt-1 text-sm text-slate-500">Signed in as</p>
          <p className="mt-0.5 font-medium text-slate-900">{user?.email}</p>
          <form action={signOut} className="mt-4">
            <button className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
              Sign out
            </button>
          </form>
        </section>

        {/* Export */}
        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-soft">
          <h2 className="text-base font-semibold">Your data</h2>
          <p className="mt-1 mb-4 text-sm text-slate-500">
            Everything you put in, you can take out. No lock-in. Transactions round-trip straight back
            into Import.
          </p>
          <div className="flex flex-wrap gap-2">
            <a href="/api/export/transactions" download className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
              ↓ Transactions (.csv)
            </a>
            <a href="/api/export/holdings" download className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
              ↓ Holdings snapshot (.csv)
            </a>
          </div>
        </section>

        {/* Danger zone */}
        <section className="rounded-2xl border border-rose-200 bg-white p-6 shadow-soft">
          <h2 className="text-base font-semibold text-rose-700">Danger zone</h2>
          <p className="mt-1 mb-4 text-sm text-slate-500">
            Delete your account and everything in it. Consider exporting your data first, this can&apos;t
            be undone.
          </p>
          <DeleteAccountButton />
        </section>
      </div>
    </main>
  );
}
