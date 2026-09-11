"use client";

import { useRef, useState } from "react";
import { addCashEntry } from "@/app/dashboard/cash/actions";

type PortfolioOpt = { id: string; name: string };

export default function AddCashEntryForm({ portfolios, base = "USD" }: { portfolios: PortfolioOpt[]; base?: string }) {
  const ref = useRef<HTMLFormElement>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = "w-full rounded-lg border border-slate-300 px-2 py-1.5 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200";

  return (
    <form
      ref={ref}
      action={async (fd) => {
        setPending(true);
        setError(null);
        try {
          const r = await addCashEntry(fd);
          if (r.ok) ref.current?.reset();
          else setError(r.error);
        } catch {
          setError("Something went wrong on our side. Nothing was added — please try again.");
        } finally {
          setPending(false);
        }
      }}
      className="space-y-2 text-sm"
    >
      {portfolios.length > 0 && (
        <select name="portfolio_id" aria-label="Account" defaultValue={portfolios[0]?.id} className={input}>
          {portfolios.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      )}
      <div className="flex gap-2">
        <select name="direction" aria-label="Direction" className={`${input} w-1/2`}>
          <option value="in">Money in</option>
          <option value="out">Money out</option>
        </select>
        <input name="amount" type="number" step="any" min="0" required aria-label="Amount" placeholder="Amount" className={`${input} w-1/3`} />
        <input name="currency" defaultValue={base} aria-label="Currency" maxLength={3} className={`${input} w-1/4 uppercase`} />
      </div>
      <input name="description" aria-label="Description" maxLength={200} placeholder="Description (e.g. paycheck, interest)" className={input} />
      <input name="entry_date" type="date" aria-label="Entry date" className={`${input} text-slate-600`} />
      <button disabled={pending} className="w-full rounded-lg bg-indigo-600 py-2 font-medium text-white hover:bg-indigo-700 disabled:opacity-60">
        {pending ? "Adding…" : "Add ledger entry"}
      </button>
      {error && <p role="alert" className="text-xs text-rose-600">{error}</p>}
    </form>
  );
}
