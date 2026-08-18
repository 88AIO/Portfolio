"use client";

import { useState } from "react";
import { syncBrokerAccounts } from "@/app/dashboard/broker/actions";

export default function BrokerConnect() {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function sync() {
    setBusy(true);
    setMsg(null);
    const res = await syncBrokerAccounts();
    setMsg(
      res.ok
        ? `Synced ${res.accounts ?? 0} account(s): ${res.holdings ?? 0} holding(s).`
        : res.message ?? "Sync failed."
    );
    setBusy(false);
  }

  return (
    <div className="space-y-3">
      <button
        onClick={sync}
        disabled={busy}
        className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
      >
        {busy ? "Syncing…" : "Sync now"}
      </button>
      {msg && <p className="text-sm text-slate-600">{msg}</p>}
    </div>
  );
}
