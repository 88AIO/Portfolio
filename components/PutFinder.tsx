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

  // IV rank: high rank = premium is genuinely rich vs. this name's own history.
  const rankClass = (r: number | null) =>
    r == null ? "text-slate-300" : r >= 66 ? "text-emerald-600" : r >= 33 ? "text-amber-600" : "text-slate-500";

  const safetyClass = (band: string) =>
    band === "very-safe" ? "bg-[#edf3ee] text-[#184c3e]"
      : band === "safe" ? "bg-emerald-50 text-emerald-700"
      : band === "watch" ? "bg-amber-50 text-amber-700"
      : band === "at-risk" ? "bg-rose-50 text-rose-700"
      : "bg-slate-100 text-slate-400";

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
              No liquid puts came back. The market may be closed or quotes are thin right now. Try again later.
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
                    <th className="pb-2 text-right">IV rank</th>
                    <th className="pb-2 text-right">Div yield</th>
                    <th className="pb-2 text-right">Div safety</th>
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
                        {r.iv != null ? `${r.iv.toFixed(0)}%` : "-"}
                      </td>
                      <td className={`py-2.5 text-right tabular-nums ${rankClass(r.ivRank)}`}>
                        {r.ivRank != null ? (
                          r.ivRank.toFixed(0)
                        ) : (
                          <span className="text-[11px] text-slate-400">{r.ivBuilding ? "building" : "-"}</span>
                        )}
                      </td>
                      <td className="py-2.5 text-right tabular-nums text-slate-500">
                        {r.divYield != null ? `${r.divYield.toFixed(2)}%` : "-"}
                      </td>
                      <td className="py-2.5 text-right">
                        {r.safetyScore != null ? (
                          <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${safetyClass(r.safetyBand)}`}>
                            {r.safetyScore}
                          </span>
                        ) : (
                          <span className="text-[11px] text-slate-400">-</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-3 text-xs text-slate-400">
                <strong>IV rank</strong> shows where today&apos;s implied volatility sits in this name&apos;s own
                trailing range (0 = calmest, 100 = richest premium vs. its history). It reads
                &ldquo;building&rdquo; until we&apos;ve gathered enough samples to be honest. <strong>Div safety</strong> is
                a 0 to 100 read from the payout record. Informational only, never advice.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
