"use client";

import { useRef, useState } from "react";
import { addTransaction } from "@/app/dashboard/actions";

export default function AddHoldingForm() {
  const ref = useRef<HTMLFormElement>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      ref={ref}
      action={async (fd) => {
        setPending(true);
        setError(null);
        try {
          await addTransaction(fd);
          ref.current?.reset();
        } catch {
          setError("Couldn't add that. Check the symbol and try again.");
        } finally {
          setPending(false);
        }
      }}
      className="space-y-2 text-sm"
    >
      <div className="flex gap-2">
        <input name="symbol" required aria-label="Symbol" placeholder="Symbol" className="w-2/3 rounded-lg border border-slate-300 px-2 py-1.5 uppercase outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200" />
        <input name="exchange" defaultValue="US" aria-label="Exchange" placeholder="Exch" className="w-1/3 rounded-lg border border-slate-300 px-2 py-1.5 uppercase outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200" />
      </div>
      <select name="type" aria-label="Transaction type" className="w-full rounded-lg border border-slate-300 px-2 py-1.5 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200">
        <option value="buy">Buy</option>
        <option value="sell">Sell</option>
        <option value="dividend">Dividend</option>
      </select>
      <div className="flex gap-2">
        <input name="quantity" type="number" step="any" min="0" required aria-label="Shares" placeholder="Shares" className="w-1/2 rounded-lg border border-slate-300 px-2 py-1.5 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200" />
        <input name="price" type="number" step="any" min="0" aria-label="Price per share" placeholder="Price" className="w-1/2 rounded-lg border border-slate-300 px-2 py-1.5 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200" />
      </div>
      <input name="executed_at" type="date" aria-label="Trade date" className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-slate-500 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200" />
      <button disabled={pending} className="w-full rounded-lg bg-indigo-600 py-2 font-medium text-white hover:bg-indigo-700 disabled:opacity-60">
        {pending ? "Adding…" : "Add transaction"}
      </button>
      {error && <p className="text-xs text-rose-600">{error}</p>}
    </form>
  );
}
