import Link from "next/link";
import DashboardNav from "@/components/DashboardNav";
import PutFinder from "@/components/PutFinder";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // the scan pulls option chains for a bounded universe.

export default function PutFinderPage() {
  return (
    <main className="min-h-screen bg-gradient-to-b from-slate-50 to-slate-100 text-slate-800">
      <DashboardNav active="options" />

      <div className="mx-auto max-w-6xl px-6 py-8">
        <div className="mb-5">
          <Link href="/dashboard/options" className="text-sm text-indigo-600 hover:underline">← Back to Options</Link>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-soft">
          <h1 className="text-base font-semibold">Cash-secured put finder</h1>
          <p className="mt-1 text-sm text-slate-500">
            Scans your holdings plus a small set of liquid US names for out-of-the-money puts, ranked by
            annualized return-on-capital. Rich premium usually means high implied volatility — so the IV column is
            colored low → high to keep risk visible.
          </p>
          <div className="mt-4 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">
            Informational only — this is not a recommendation to sell any option. IV shown is current implied
            volatility (a 52-week <em>IV-rank</em> and a dividend-safety score are on the roadmap).
          </div>
          <div className="mt-5">
            <PutFinder />
          </div>
        </div>
      </div>
    </main>
  );
}
