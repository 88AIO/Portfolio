"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { checkSplits } from "@/app/dashboard/holding/[id]/split-actions";

// Ask the market-data provider about this holding's splits right now, rather than waiting for the
// nightly sync. One provider call per click, and the button is disabled while it runs.
//
// It reports "no splits on record" as a success, not silence: an empty section should not leave you
// wondering whether the stock never split or nobody ever looked.
export default function CheckSplitsButton({ instrumentId }: { instrumentId: string }) {
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [ok, setOk] = useState<boolean | null>(null);
  const router = useRouter();

  return (
    <div className="flex flex-col items-end gap-1.5">
      <button
        type="button"
        onClick={() =>
          startTransition(async () => {
            setMsg(null);
            const res = await checkSplits(instrumentId);
            setOk(res.ok);
            setMsg(res.message);
            // Pull the new rows into the list without making the user reload by hand.
            if (res.ok) router.refresh();
          })
        }
        disabled={pending}
        className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-50 disabled:opacity-60"
      >
        {pending ? (
          <>
            <span className="h-3 w-3 animate-spin rounded-full border-2 border-slate-300 border-t-slate-500" />
            Checking…
          </>
        ) : (
          "Check for splits now"
        )}
      </button>
      {msg && (
        <p className={`max-w-xs text-right text-xs ${ok ? "text-emerald-600" : "text-rose-600"}`}>{msg}</p>
      )}
    </div>
  );
}
