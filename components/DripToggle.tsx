"use client";

import { toggleDrip } from "@/app/dashboard/actions";

// Mark an already-recorded purchase as a reinvested dividend, or take the mark off.
//
// Lives on the row rather than behind an edit screen because the realistic job is going down an
// imported ledger tagging the reinvestments, and a dialog per row would make that unbearable.
export default function DripToggle({
  id,
  instrumentId,
  isDrip,
  locked,
}: {
  id: string;
  instrumentId: string;
  isDrip: boolean;
  /** True when the broker's own description already says DRIP — nothing to toggle. */
  locked?: boolean;
}) {
  if (locked) {
    return (
      <span
        title="Your broker's description says this was a reinvested dividend."
        className="rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700"
      >
        DRIP
      </span>
    );
  }
  return (
    <form action={toggleDrip}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="instrument_id" value={instrumentId} />
      <input type="hidden" name="next" value={isDrip ? "0" : "1"} />
      <button
        type="submit"
        title={isDrip ? "Marked as a reinvested dividend — click to unmark" : "Mark as a reinvested dividend"}
        aria-label={isDrip ? "Unmark as reinvested dividend" : "Mark as reinvested dividend"}
        className={
          isDrip
            ? "rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700 transition hover:bg-emerald-100"
            : // Faint until hovered: on a long purchase history the marks should stand out, not the
              // dozens of rows offering to be marked.
              "rounded-full border border-dashed border-slate-200 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-300 opacity-0 transition hover:border-emerald-300 hover:text-emerald-600 focus:opacity-100 group-hover:opacity-100"
        }
      >
        DRIP
      </button>
    </form>
  );
}
