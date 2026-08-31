"use client";

// The value chart plus its time-range control.
//
// Filtering happens in the browser against the full series the server already sent, so switching
// range is instant — no refetch, no spinner, no layout jump. The series is a few hundred points at
// most, which is nothing next to the recharts bundle already on the page.
import { useMemo, useState } from "react";
import { PerformanceChart } from "@/components/charts";
import {
  RANGE_PRESETS,
  filterByRange,
  rangeChange,
  tickFormatterFor,
  type RangeKey,
} from "@/lib/performance/ranges";
import { money, pct } from "@/lib/format";

type Point = { date: string; value: number; invested: number; benchmark?: number };

export default function PerformanceRange({
  data,
  currency,
  dailyFrom,
}: {
  data: Point[];
  currency: string;
  /** First date covered by exact daily snapshots; before it the line is weekly closes. */
  dailyFrom?: string | null;
}) {
  const [range, setRange] = useState<RangeKey>("1Y");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  // The last point is "now" as far as the data is concerned; anchoring to it rather than the
  // browser clock keeps the windows aligned with what actually exists.
  const today = data.length ? data[data.length - 1].date : "";
  const first = data.length ? data[0].date : "";

  const shown = useMemo(
    () => filterByRange(data, range, today, { from, to }),
    [data, range, today, from, to]
  );
  const tickFormatter = useMemo(() => tickFormatterFor(shown), [shown]);
  const change = useMemo(() => rangeChange(shown), [shown]);

  const btn = (active: boolean) =>
    [
      "rounded-lg px-2.5 py-1 text-xs font-medium transition-colors",
      active
        ? "bg-slate-900 text-white"
        : "text-slate-500 hover:bg-slate-100 hover:text-slate-700",
    ].join(" ");

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Chart time range">
        {RANGE_PRESETS.map((r) => (
          <button
            key={r.key}
            type="button"
            title={r.title}
            aria-pressed={range === r.key}
            onClick={() => setRange(r.key)}
            className={btn(range === r.key)}
          >
            {r.label}
          </button>
        ))}
        <span className="mx-1 h-4 w-px bg-slate-200" aria-hidden />
        <button
          type="button"
          title="Pick your own dates"
          aria-pressed={range === "CUSTOM"}
          onClick={() => setRange("CUSTOM")}
          className={btn(range === "CUSTOM")}
        >
          Custom
        </button>

        {range === "CUSTOM" && (
          <span className="ml-1 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
            <label className="sr-only" htmlFor="perf-from">From</label>
            <input
              id="perf-from"
              type="date"
              value={from}
              min={first || undefined}
              max={today || undefined}
              onChange={(e) => setFrom(e.target.value)}
              className="rounded-lg border border-slate-200 px-2 py-1 text-xs text-slate-700 focus:ring-2 focus:ring-slate-300 focus:outline-none"
            />
            <span aria-hidden>→</span>
            <label className="sr-only" htmlFor="perf-to">To</label>
            <input
              id="perf-to"
              type="date"
              value={to}
              min={first || undefined}
              max={today || undefined}
              onChange={(e) => setTo(e.target.value)}
              className="rounded-lg border border-slate-200 px-2 py-1 text-xs text-slate-700 focus:ring-2 focus:ring-slate-300 focus:outline-none"
            />
          </span>
        )}
      </div>

        {change && (
          <div className="text-right">
            <div
              className={`text-sm font-semibold tabular-nums ${
                change.valueAbs >= 0 ? "text-emerald-600" : "text-rose-600"
              }`}
            >
              {change.valueAbs >= 0 ? "+" : "−"}
              {money(Math.abs(change.valueAbs), currency)}
              {change.valuePct != null && <> ({pct(change.valuePct)})</>}
            </div>
            <div className="text-xs text-slate-400">
              value over this range
              {Math.abs(change.valueAbs - change.gainAbs) > 1 && (
                <>
                  {" · "}
                  {change.gainAbs >= 0 ? "+" : "−"}
                  {money(Math.abs(change.gainAbs), currency)} from the market
                </>
              )}
            </div>
          </div>
        )}
      </div>

      <PerformanceChart data={shown} currency={currency} tickFormatter={tickFormatter} />

      <p className="mt-3 text-xs text-slate-400">
        {shown.length ? (
          <>
            Showing {shown[0].date} to {shown[shown.length - 1].date}.{" "}
          </>
        ) : null}
        {dailyFrom ? (
          <>
            Exact daily values from {dailyFrom}; weekly closing prices before that, so short ranges
            reaching further back will look stepped.
          </>
        ) : (
          <>Built from weekly closing prices, so a one-month view has about four points.</>
        )}
      </p>
    </div>
  );
}
