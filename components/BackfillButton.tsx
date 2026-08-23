"use client";

import { useState, useTransition } from "react";
import { backfillHistory } from "@/app/dashboard/performance/actions";

// Owner-only one-time control to deepen the price-history cache so the chart reaches back to
// inception. Runs a Server Action (uses the signed-in session), shows a spinner while it fetches
// several years of weekly closes, then the result message.
export default function BackfillButton() {
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [ok, setOk] = useState<boolean | null>(null);

  return (
    <div className="flex flex-col items-end gap-1.5">
      <button
        onClick={() =>
          startTransition(async () => {
            setMsg(null);
            const res = await backfillHistory();
            setOk(res.ok);
            setMsg(res.message);
          })
        }
        disabled={pending}
        className="inline-flex items-center gap-2 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-medium text-indigo-700 hover:bg-indigo-100 disabled:opacity-60"
      >
        {pending ? (
          <>
            <span className="h-3 w-3 animate-spin rounded-full border-2 border-indigo-300 border-t-indigo-600" />
            Backfilling… (up to ~2 min)
          </>
        ) : (
          "Extend chart back to 2020"
        )}
      </button>
      {msg && (
        <p className={`max-w-xs text-right text-xs ${ok ? "text-emerald-600" : "text-rose-600"}`}>{msg}</p>
      )}
    </div>
  );
}
