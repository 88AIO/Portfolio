"use client";

import { useState } from "react";
import { scanPutFinder } from "@/app/dashboard/options/finder-actions";
import type { FinderResult } from "@/lib/options";
import { money, pct } from "@/lib/format";

export default function PutFinder() {
  const [res, setRes] = useState<FinderResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [dte, setDte] = useState(35);
  const [otm, setOtm] = useState(6);

  const scan = async () => {
    setLoading(true);
    try {
      setRes(await scanPutFinder({ targetDte: dte, otmPct: otm }));
    } finally {
      setLoading(false);
    }
  };

  const input = "w-20 rounded-lg border border-slate-300 px-2 py-1.5 text-sm outline-none focus:border-indigo-400";

  // Color IV low→high so rich-but-risky premium is obvious at a glance.
  const ivClass = (iv: number | null) =>
    iv == null ? "text-slate-300" : iv >= 60 ? "text-rose-600" : iv >= 35 ? "text-amber-600" : "text-emerald-600";

  return (
    <div>
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm">
          <span className="mb-1 block text-xs text-slate-400">Target DTE</span>
          <input type="number" min={7} max={90} value={dte} onChange={(e) => setDte(Number(e.target.value))} className={input} />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-xs text-slate-400">% OTM</span>
          <input type="number" min={0} max={30} value={otm} onChange={(e) => setOtm(Number(e.target.value))} className={input} />
        </label>
        <button
          onClick={scan}
          disabled={loading}
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
        >
          {loading ? "Scanning…" : "Scan for put premium"}
        </button>
      </div>

      {res && (
        <div className="mt-5">
          <p className="mb-3 text-xs text-slate-400">
            Ranked by annualized return-on-capital · scanned {res.scanned} names at ~{res.targetDte} DTE, ~{res.otmPct}% OTM
            {res.truncated ? " · universe capped to stay on the free tier" : ""}.
          </p>
          {res.rows.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-400">
              No liquid puts came back — the market may be closed or quotes are thin right now. Try again later.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-[11px] uppercase tracking-wide text-slate-400">
                  <tr>
                    <th className="pb-2">Underlying</th>
                    <th className="pb-2 text-right">Price</th>
                    <th className="pb-2 text-right">Put strike</th>
                    <th className="pb-2 text-right">Exp (DTE)</th>
                    <th className="pb-2 text-right">Premium</th>
                    <th className="pb-2 text-right">Ann. RoC</th>
                    <th className="pb-2 text-right">IV</th>
                    <th className="pb-2 text-right">Div yield</th>
                  </tr>
                </thead>
                <tbody>
                  {res.rows.map((r) => (
                    <tr key={r.symbol} className="border-t border-slate-100 hover:bg-slate-50/60">
                      <td className="py-2.5 font-medium text-slate-900">
                        {r.symbol}
                        {r.held && <span className="ml-1.5 rounded-full bg-indigo-50 px-1.5 py-0.5 text-[10px] font-medium text-indigo-600">held</span>}
                      </td>
                      <td className="py-2.5 text-right tabular-nums">{money(r.price)}</td>
                      <td className="py-2.5 text-right tabular-nums">{money(r.strike)}</td>
                      <td className="py-2.5 text-right tabular-nums text-slate-500">
                        {r.expiration} <span className="text-slate-400">({r.dte}d)</span>
                      </td>
                      <td className="py-2.5 text-right tabular-nums text-emerald-600">{money(r.premium)}</td>
                      <td className="py-2.5 text-right tabular-nums font-semibold">{pct(r.annualizedRoC)}</td>
                      <td className={`py-2.5 text-right tabular-nums ${ivClass(r.iv)}`}>
                        {r.iv != null ? `${r.iv.toFixed(0)}%` : "—"}
                      </td>
                      <td className="py-2.5 text-right tabular-nums text-slate-500">
                        {r.divYield != null ? `${r.divYield.toFixed(2)}%` : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
