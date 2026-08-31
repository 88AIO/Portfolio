import { addSplit, deleteSplit } from "@/app/dashboard/holding/[id]/split-actions";
import type { SplitRecord } from "@/lib/corporate/load";

// Corporate actions on one holding.
//
// This is a correctness tool, not a feature people go looking for, so it states plainly what a
// split does to the numbers on the rest of the page and stays out of the way otherwise. The
// provider fills most of these in overnight; the form exists for the ones it misses or gets wrong.

function describe(ratio: number): string {
  // Show people the shape they recognise from a press release rather than a decimal. 0.1 is a
  // 1-for-10 reverse split, and reading it as "0.1" invites exactly the wrong mental picture.
  if (ratio >= 1) {
    const rounded = Math.round(ratio * 1000) / 1000;
    return `${rounded}-for-1`;
  }
  const inverse = Math.round((1 / ratio) * 1000) / 1000;
  return `1-for-${inverse} (reverse)`;
}

export default function SplitsSection({
  instrumentId,
  symbol,
  splits,
}: {
  instrumentId: string;
  symbol: string;
  splits: SplitRecord[];
}) {
  return (
    <section className="mt-8 rounded-2xl border border-slate-200 bg-white p-5">
      <h2 className="font-semibold">Splits on {symbol}</h2>
      <p className="mb-4 max-w-2xl text-xs text-slate-400">
        A split changes how many shares you hold, never what you paid. Your transactions are left
        exactly as your broker recorded them — the share count and average cost above are
        recalculated from these instead. Most arrive automatically overnight; add one here if a
        split is missing, or enter the correct ratio to replace one that looks wrong.
      </p>

      {splits.length > 0 && (
        <ul className="mb-5 divide-y divide-slate-100 text-sm">
          {splits.map((s) => (
            <li key={`${s.exDate}-${s.source}`} className="flex items-center justify-between gap-3 py-2.5">
              <div>
                <div className="font-medium">{describe(s.ratio)}</div>
                <div className="text-xs text-slate-400">
                  {s.exDate}
                  {s.source === "manual" ? " · added by you" : " · from market data"}
                  {s.note ? ` · ${s.note}` : ""}
                </div>
              </div>
              {s.source === "manual" && s.id ? (
                <form action={deleteSplit}>
                  <input type="hidden" name="split_id" value={s.id} />
                  <input type="hidden" name="instrument_id" value={instrumentId} />
                  <button
                    type="submit"
                    aria-label={`Remove the ${s.exDate} split`}
                    title="Remove"
                    className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-xs text-slate-400 transition hover:bg-rose-50 hover:text-rose-500"
                  >
                    ✕
                  </button>
                </form>
              ) : (
                // Shared market data: correcting it means overriding it for this portfolio, not
                // deleting it for everyone who holds the same stock.
                <span className="text-xs text-slate-300" title="From market data — add the same date below to override it">
                  synced
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      <form action={addSplit} className="flex flex-wrap items-end gap-3">
        <input type="hidden" name="instrument_id" value={instrumentId} />
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-slate-500">Split date</span>
          <input
            type="date"
            name="ex_date"
            required
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-slate-500">Ratio</span>
          <input
            type="text"
            name="ratio"
            required
            placeholder="4-for-1"
            // Free text rather than a number box: "4-for-1" and "1-for-10" are how splits are
            // announced, and asking someone to convert a reverse split to 0.1 in their head is
            // how you get a holding multiplied by ten.
            className="w-32 rounded-lg border border-slate-200 px-3 py-2 text-sm"
          />
        </label>
        <label className="flex flex-1 flex-col gap-1">
          <span className="text-xs font-medium text-slate-500">Note (optional)</span>
          <input
            type="text"
            name="note"
            maxLength={200}
            placeholder="e.g. confirmed on the broker statement"
            className="w-full min-w-[12rem] rounded-lg border border-slate-200 px-3 py-2 text-sm"
          />
        </label>
        <button
          type="submit"
          className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-700"
        >
          Add split
        </button>
      </form>
      <p className="mt-2 text-xs text-slate-400">
        Enter it the way it was announced — <span className="text-slate-500">4-for-1</span>, or{" "}
        <span className="text-slate-500">1-for-10</span> for a reverse split. Adding a date that is
        already listed replaces it, and a ratio of{" "}
        <span className="text-slate-500">1-for-1</span> cancels a split that shouldn&apos;t be there.
      </p>
    </section>
  );
}
