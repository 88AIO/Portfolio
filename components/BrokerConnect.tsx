"use client";

import { useState } from "react";
import { startBrokerConnection, syncBrokerAccounts } from "@/app/dashboard/broker/actions";

export default function BrokerConnect() {
  const [busy, setBusy] = useState<null | "connect" | "sync">(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function connect() {
    setBusy("connect");
    setMsg(null);
    const res = await startBrokerConnection();
    if (res.url) {
      window.location.href = res.url;
      return;
    }
    setMsg(res.error ?? "Couldn't start the connection.");
    setBusy(null);
  }

  async function sync() {
    setBusy("sync");
    setMsg(null);
    const res = await syncBrokerAccounts();
    setMsg(
      res.ok
        ? `Synced ${res.accounts ?? 0} account(s): imported ${res.imported ?? 0}, skipped ${res.duplicates ?? 0} duplicate(s).`
        : res.message ?? "Sync failed."
    );
    setBusy(null);
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <button
          onClick={connect}
          disabled={busy != null}
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
        >
          {busy === "connect" ? "Opening…" : "Connect a brokerage"}
        </button>
        <button
          onClick={sync}
          disabled={busy != null}
          className="rounded-lg border border-slate-300 px-4 py-2 text-sm hover:bg-slate-50 disabled:opacity-60"
        >
          {busy === "sync" ? "Syncing…" : "Sync now"}
        </button>
      </div>
      {msg && <p className="text-sm text-slate-600">{msg}</p>}
    </div>
  );
}
