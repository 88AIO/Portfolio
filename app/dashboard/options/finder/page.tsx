import Link from "next/link";
import BrandMark from "@/components/BrandMark";
import PutFinder from "@/components/PutFinder";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // the scan pulls option chains for a bounded universe.

export default function PutFinderPage() {
  return (
    <main className="min-h-screen bg-gradient-to-b from-slate-50 to-slate-100 text-slate-800">
      <header className="border-b border-slate-800 bg-slate-900 text-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3.5">
          <div className="flex items-center gap-2.5">
            <BrandMark className="h-8 w-8" />
            <span className="text-lg font-semibold tracking-tight">Put finder</span>
          </div>
          <nav className="flex items-center gap-1 text-sm">
            <Link href="/dashboard" className="rounded-lg px-3 py-1.5 text-slate-300 hover:bg-white/10">Overview</Link>
            <Link href="/dashboard/options" className="rounded-lg px-3 py-1.5 text-slate-300 hover:bg-white/10">← Options</Link>
          </nav>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-6 py-8">
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
