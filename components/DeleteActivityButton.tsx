"use client";

import { deleteTransaction, deleteOptionLeg } from "@/app/dashboard/actions";

// Small ✕ that removes one activity row (a transaction or an option leg) from the holding page.
// Confirms first so a stray tap can't silently wipe a trade; the server action is RLS-scoped, so it
// can only ever delete a row the signed-in user owns.
export default function DeleteActivityButton({
  id,
  instrumentId,
  source,
}: {
  id: string;
  instrumentId: string;
  source: "tx" | "option";
}) {
  const action = source === "option" ? deleteOptionLeg : deleteTransaction;
  const label = source === "option" ? "option leg" : "transaction";
  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (!confirm(`Delete this ${label}? This can't be undone.`)) e.preventDefault();
      }}
    >
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="instrument_id" value={instrumentId} />
      <button
        type="submit"
        aria-label={`Delete ${label}`}
        title="Delete"
        className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-xs text-slate-300 transition hover:bg-rose-50 hover:text-rose-500"
      >
        ✕
      </button>
    </form>
  );
}
