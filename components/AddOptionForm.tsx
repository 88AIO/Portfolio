"use client";

import { useRef, useState } from "react";
import { addOptionTransaction } from "@/app/dashboard/options/actions";

type PortfolioOpt = { id: string; name: string };

export default function AddOptionForm({ portfolios }: { portfolios: PortfolioOpt[] }) {
  const ref = useRef<HTMLFormElement>(null);
  const [pending, setPending] = useState(false);
  const [action, setAction] = useState("sell_to_open");
  const [error, setError] = useState<string | null>(null);

  const input =
    "w-full rounded-lg border border-slate-300 px-2 py-1.5 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200";

  return (
    <form
      ref={ref}
      action={async (fd) => {
        setPending(true);
        setError(null);
        try {
          await addOptionTransaction(fd);
          ref.current?.reset();
          setAction("sell_to_open");
        } catch {
          setError("Couldn't log that option. Check the fields and try again.");
        } finally {
          setPending(false);
        }
      }}
      className="space-y-2 text-sm"
    >
      <div className="flex gap-2">
        <input name="symbol" required placeholder="Underlying" className={`${input} w-2/3 uppercase`} />
        <input name="exchange" defaultValue="US" placeholder="Exch" className={`${input} w-1/3 uppercase`} />
      </div>

      <div className="flex gap-2">
        <select name="action" value={action} onChange={(e) => setAction(e.target.value)} className={input}>
          <option value="sell_to_open">Sell to open</option>
          <option value="buy_to_close">Buy to close</option>
          <option value="expired">Expired</option>
          <option value="assigned">Assigned</option>
          <option value="rolled">Rolled (close leg)</option>
        </select>
        <select name="option_type" className={input}>
          <option value="put">Put</option>
          <option value="call">Call</option>
        </select>
      </div>

      <div className="flex gap-2">
        <input name="strike" type="number" step="any" required placeholder="Strike" className={`${input} w-1/2`} />
        <input name="contracts" type="number" step="1" min="1" defaultValue={1} placeholder="Contracts" className={`${input} w-1/2`} />
      </div>

      <div className="flex gap-2">
        <input name="premium" type="number" step="any" required placeholder="Premium /sh" className={`${input} w-1/2`} title="Premium per share (e.g. 1.56 for $156 on one contract)" />
        <input name="fee" type="number" step="any" placeholder="Fee" className={`${input} w-1/2`} />
      </div>

      <label className="block text-xs text-slate-400">Expiration</label>
      <input name="expiration" type="date" required className={`${input} text-slate-600`} />
      <label className="block text-xs text-slate-400">Trade date</label>
      <input name="trade_date" type="date" className={`${input} text-slate-600`} />

      {portfolios.length > 1 && (
        <select name="portfolio_id" defaultValue={portfolios[0]?.id} className={input}>
          {portfolios.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      )}

      <button disabled={pending} className="w-full rounded-lg bg-indigo-600 py-2 font-medium text-white hover:bg-indigo-700 disabled:opacity-60">
        {pending ? "Saving…" : "Log option"}
      </button>
      {error && <p className="text-xs text-rose-600">{error}</p>}
      <p className="text-xs text-slate-400">
        Premium is <strong>per share</strong>. One contract at $1.56 = $156.
      </p>
    </form>
  );
}
