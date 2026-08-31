"use client";

import { deleteHolding } from "@/app/dashboard/actions";

// "Remove this holding" — deletes every transaction and option leg on one instrument.
// Named explicitly and confirmed with the symbol, because the per-row ✕ beside each activity is
// for fixing one mistyped trade; this is the one people actually want after trying a position out.
export default function RemoveHoldingButton({
  instrumentId,
  symbol,
}: {
  instrumentId: string;
  symbol: string;
}) {
  return (
    <form
      action={deleteHolding}
      onSubmit={(e) => {
        if (
          !confirm(
            `Remove ${symbol} completely?\n\nThis deletes every share transaction, dividend and option leg recorded on it. It can't be undone.`
          )
        ) {
          e.preventDefault();
        }
      }}
    >
      <input type="hidden" name="instrument_id" value={instrumentId} />
      <button
        type="submit"
        className="rounded-lg border border-rose-200 px-3 py-1.5 text-xs font-medium text-rose-600 transition hover:bg-rose-50"
      >
        Remove {symbol}
      </button>
    </form>
  );
}
