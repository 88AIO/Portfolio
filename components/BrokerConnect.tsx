"use client";

import { useState } from "react";
import { syncBrokerAccounts } from "@/app/dashboard/broker/actions";

export default function BrokerConnect() {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; accounts?: number; holdings?: number; options?: number; message?: string } | null>(null);
  const [debug, setDebug] = useState<string | null>(null);
  const [showDetails, setShowDetails] = useState(false);

  async function sync() {
    setBusy(true);
    setResult(null);
    setDebug(null);
    try {
      const res = await syncBrokerAccounts();
      setResult(res);
      setDebug(res.debug ?? null);
    } catch {
      setResult({ ok: false, message: "Something went wrong. Please try again." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={sync}
          disabled={busy}
          className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700 disabled:opacity-60"
        >
          {busy ? (
            <>
              <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
              </svg>
              Updating…
            </>
          ) : (
            <>
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 2v6h-6M3 12a9 9 0 0115-6.7L21 8M3 22v-6h6M21 12a9 9 0 01-15 6.7L3 16" />
              </svg>
              Refresh now
            </>
          )}
        </button>
        <span className="text-xs text-slate-400">Usually takes a few seconds.</span>
      </div>

      {result && result.ok && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-3.5">
          <div className="flex items-center gap-2 text-sm font-semibold text-emerald-800">
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 6L9 17l-5-5" />
            </svg>
            You&apos;re up to date
          </div>
          <p className="mt-1 text-sm text-emerald-700">
            {[
              result.accounts ? `${result.accounts} account${result.accounts === 1 ? "" : "s"}` : null,
              result.holdings ? `${result.holdings} holding${result.holdings === 1 ? "" : "s"}` : null,
              result.options ? `${result.options} option trade${result.options === 1 ? "" : "s"}` : null,
            ].filter(Boolean).join(" · ") || "Nothing new to import."}
          </p>
        </div>
      )}

      {result && !result.ok && (
        <div className="rounded-xl border border-rose-200 bg-rose-50/60 p-3.5 text-sm text-rose-700">
          {result.message ?? "Sync failed. Please try again."}
        </div>
      )}

      {debug && (
        <div className="text-xs">
          <button onClick={() => setShowDetails((s) => !s)} className="text-slate-400 underline decoration-dotted hover:text-slate-600">
            {showDetails ? "Hide technical details" : "Show technical details"}
          </button>
          {showDetails && (
            <p className="mt-2 whitespace-pre-wrap break-words rounded-lg bg-slate-50 p-3 font-mono text-[11px] leading-relaxed text-slate-500">
              {debug}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
