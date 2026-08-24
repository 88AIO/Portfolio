"use client";

import { useState } from "react";
import { money, pct, num } from "@/lib/format";
import { wheelPhaseLabel, type WheelRow, type WheelEvent } from "@/lib/options/wheel";

// The Wheel cycles table: one summary row per underlying, each expandable to reveal that ticker's
// entire history since inception — every put/call leg plus the share assignments and dividends
// that make up the wheel. Informational only (see CLAUDE.md — track & inform, never advise).
export default function WheelCycles({
  wheels,
  history,
  base,
}: {
  wheels: WheelRow[];
  history: Record<string, WheelEvent[]>;
  base: string;
}) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const toggle = (sym: string) => setOpen((o) => ({ ...o, [sym]: !o[sym] }));

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-left text-[11px] uppercase tracking-wide text-slate-400">
          <tr>
            <th className="pb-2 pr-2">Stock</th>
            <th className="px-2 pb-2" title="What you're doing on this name right now.">Doing now</th>
            <th className="px-2 pb-2 text-right" title="Option premium you've kept on this stock.">Premium</th>
            <th className="px-2 pb-2 text-right" title="Dividends collected while holding it.">Dividends</th>
            <th className="px-2 pb-2 text-right" title="Profit or loss from shares you've sold.">Stock gains</th>
            <th className="px-2 pb-2 text-right" title="Premium + dividends + stock gains.">Total earned</th>
            <th className="px-2 pb-2 text-right" title="A rough yearly return on the cash tied up.">Return / yr</th>
            <th className="pb-2 pl-2" />
          </tr>
        </thead>
        <tbody>
          {wheels.map((w) => {
            const events = history[w.symbol] ?? [];
            const isOpen = !!open[w.symbol];
            return (
              <FragmentRow
                key={w.symbol}
                w={w}
                base={base}
                events={events}
                isOpen={isOpen}
                onToggle={() => toggle(w.symbol)}
              />
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function FragmentRow({
  w,
  base,
  events,
  isOpen,
  onToggle,
}: {
  w: WheelRow;
  base: string;
  events: WheelEvent[];
  isOpen: boolean;
  onToggle: () => void;
}) {
  const canExpand = events.length > 0;
  return (
    <>
      <tr
        className={`border-t border-slate-100 ${canExpand ? "cursor-pointer hover:bg-slate-50/60" : ""}`}
        onClick={canExpand ? onToggle : undefined}
      >
        <td className="py-2.5 pr-2">
          <div className="flex items-center gap-1.5">
            {canExpand && (
              <span className={`text-slate-400 transition-transform ${isOpen ? "rotate-90" : ""}`} aria-hidden>
                ▸
              </span>
            )}
            <span className="font-medium text-slate-900">{w.symbol}</span>
          </div>
          <div className="mt-0.5 pl-[18px] text-[11px] text-slate-400">
            {w.shares > 0 ? `${num(w.shares, 0)} sh` : "no shares"}
            {w.openPuts > 0 ? ` · ${w.openPuts}P` : ""}
            {w.openCalls > 0 ? ` · ${w.openCalls}C` : ""}
          </div>
        </td>
        <td className="px-2 py-2.5"><PhaseBadge phase={w.phase} /></td>
        <td className="whitespace-nowrap px-2 py-2.5 text-right tabular-nums text-emerald-600">{money(w.premium, base)}</td>
        <td className="whitespace-nowrap px-2 py-2.5 text-right tabular-nums text-slate-500">{money(w.dividends, base)}</td>
        <td className={`whitespace-nowrap px-2 py-2.5 text-right tabular-nums ${w.realizedStock >= 0 ? "text-slate-500" : "text-rose-600"}`}>
          {w.realizedStock !== 0 ? money(w.realizedStock, base) : "-"}
        </td>
        <td className={`whitespace-nowrap px-2 py-2.5 text-right tabular-nums font-semibold ${w.totalProfit >= 0 ? "text-slate-900" : "text-rose-600"}`}>{money(w.totalProfit, base)}</td>
        <td className="whitespace-nowrap px-2 py-2.5 text-right tabular-nums">
          {w.annualizedReturn != null ? (
            <span className={w.annualizedReturn >= 0 ? "text-emerald-600" : "text-rose-600"}>{pct(w.annualizedReturn)}</span>
          ) : (
            <span className="text-slate-300">-</span>
          )}
        </td>
        <td className="py-2.5 pl-2 text-right text-[11px] text-slate-400">
          {canExpand ? (isOpen ? "Hide" : `${events.length}`) : ""}
        </td>
      </tr>
      {isOpen && canExpand && (
        <tr className="bg-slate-50/60">
          <td colSpan={8} className="px-4 py-3">
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              {w.symbol} full history ({events.length} event{events.length === 1 ? "" : "s"})
            </div>
            <ul className="space-y-1">
              {events.map((e, i) => (
                <li key={i} className="flex items-center justify-between gap-3 border-b border-slate-100 py-1.5 last:border-0">
                  <div className="flex items-center gap-2.5">
                    <span className={`h-2 w-2 shrink-0 rounded-full ${dot(e)}`} />
                    <div>
                      <div className="text-[13px] font-medium text-slate-700">{e.title}</div>
                      <div className="text-[11px] text-slate-400">{e.detail}</div>
                    </div>
                  </div>
                  <div className="text-right">
                    {e.amount != null && (
                      <div className={`text-[13px] font-medium tabular-nums ${e.amount >= 0 ? "text-emerald-600" : "text-slate-600"}`}>
                        {e.amount >= 0 ? "+" : ""}{money(e.amount, e.currency)}
                      </div>
                    )}
                    <div className="text-[11px] text-slate-400">{e.date}</div>
                  </div>
                </li>
              ))}
            </ul>
          </td>
        </tr>
      )}
    </>
  );
}

// Option premium is brass (the signature income); a share purchase (assignment) is amber;
// a sale is a quiet gray; dividends are money-green.
function dot(e: WheelEvent): string {
  if (e.kind === "option") return "bg-[#b98a34]";
  if (e.kind === "buy") return "bg-amber-400";
  if (e.kind === "sell") return "bg-slate-400";
  return "bg-emerald-500";
}

function PhaseBadge({ phase }: { phase: WheelRow["phase"] }) {
  const map = {
    selling_puts: "bg-[#edf3ee] text-[#205d4a]",
    covered_call: "bg-[#f6ecd8] text-[#8a6a1f]",
    holding: "bg-emerald-50 text-emerald-700",
    idle: "bg-slate-100 text-slate-500",
  } as const;
  return <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${map[phase]}`}>{wheelPhaseLabel(phase)}</span>;
}
