"use client";

import { useRef, useState } from "react";
import { addTransaction } from "@/app/dashboard/actions";

export default function AddHoldingForm() {
  const ref = useRef<HTMLFormElement>(null);
  const [pending, setPending] = useState(false);

  return (
    <form
      ref={ref}
      action={async (fd) => {
        setPending(true);
        await addTransaction(fd);
        ref.current?.reset();
        setPending(false);
      }}
      className="space-y-2 text-sm"
    >
      <div className="flex gap-2">
        <input name="symbol" required placeholder="Symbol" className="w-2/3 rounded-lg border border-slate-300 px-2 py-1.5 uppercase outline-none focus:border-indigo-400" />
        <input name="exchange" defaultValue="US" placeholder="Exch" className="w-1/3 rounded-lg border border-slate-300 px-2 py-1.5 uppercase outline-none focus:border-indigo-400" />
      </div>
      <select name="type" className="w-full rounded-lg border border-slate-300 px-2 py-1.5 outline-none focus:border-indigo-400">
        <option value="buy">Buy</option>
        <option value="sell">Sell</option>
        <option value="dividend">Dividend</option>
      </select>
      <div className="flex gap-2">
        <input name="quantity" type="number" step="any" required placeholder="Shares" className="w-1/2 rounded-lg border border-slate-300 px-2 py-1.5 outline-none focus:border-indigo-400" />
        <input name="price" type="number" step="any" placeholder="Price" className="w-1/2 rounded-lg border border-slate-300 px-2 py-1.5 outline-none focus:border-indigo-400" />
      </div>
      <input name="executed_at" type="date" className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-slate-500 outline-none focus:border-indigo-400" />
      <button disabled={pending} className="w-full rounded-lg bg-indigo-600 py-2 font-medium text-white hover:bg-indigo-700 disabled:opacity-60">
        {pending ? "Adding…" : "Add transaction"}
      </button>
    </form>
  );
}
