"use client";

import { useRef, useState } from "react";
import { addCashEntry } from "@/app/dashboard/cash/actions";

type PortfolioOpt = { id: string; name: string };

export default function AddCashEntryForm({ portfolios }: { portfolios: PortfolioOpt[] }) {
  const ref = useRef<HTMLFormElement>(null);
  const [pending, setPending] = useState(false);
  const input = "w-full rounded-lg border border-slate-300 px-2 py-1.5 outline-none focus:border-indigo-400";

  return (
    <form
      ref={ref}
      action={async (fd) => {
        setPending(true);
        await addCashEntry(fd);
        ref.current?.reset();
        setPending(false);
      }}
      className="space-y-2 text-sm"
    >
      {portfolios.length > 0 && (
        <select name="portfolio_id" defaultValue={portfolios[0]?.id} className={input}>
          {portfolios.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      )}
      <div className="flex gap-2">
        <select name="direction" className={`${input} w-1/2`}>
          <option value="in">Money in</option>
          <option value="out">Money out</option>
        </select>
        <input name="amount" type="number" step="any" required placeholder="Amount" className={`${input} w-1/3`} />
        <input name="currency" defaultValue="USD" className={`${input} w-1/4 uppercase`} />
      </div>
      <input name="description" placeholder="Description (e.g. paycheck, interest)" className={input} />
      <input name="entry_date" type="date" className={`${input} text-slate-600`} />
      <button disabled={pending} className="w-full rounded-lg bg-indigo-600 py-2 font-medium text-white hover:bg-indigo-700 disabled:opacity-60">
        {pending ? "Adding…" : "Add ledger entry"}
      </button>
    </form>
  );
}
