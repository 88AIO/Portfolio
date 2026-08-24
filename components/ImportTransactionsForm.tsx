"use client";

import { useRef, useState } from "react";
import { importTransactions } from "@/app/dashboard/actions";
import type { ImportResult } from "@/lib/import/types";

export default function ImportTransactionsForm() {
  const ref = useRef<HTMLFormElement>(null);
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);

  return (
    <form
      ref={ref}
      action={async (fd) => {
        setPending(true);
        setResult(null);
        const r = await importTransactions(fd);
        setResult(r);
        setPending(false);
        ref.current?.reset();
      }}
      className="space-y-2 text-sm"
    >
      <input
        type="file"
        name="file"
        accept=".csv,text/csv"
        required
        className="w-full text-xs text-slate-500 file:mr-2 file:rounded-lg file:border-0 file:bg-indigo-50 file:px-3 file:py-1.5 file:font-medium file:text-indigo-700 hover:file:bg-indigo-100"
      />
      <button
        disabled={pending}
        className="w-full rounded-lg bg-indigo-600 py-2 font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
      >
        {pending ? "Importing…" : "Import CSV"}
      </button>

      {result && (
        <div className="rounded-lg bg-slate-50 p-2 text-xs">
          <p className="text-slate-600">
            Imported <b className="text-emerald-600">{result.imported}</b>
            {result.duplicates > 0 && (
              <>
                {" "}
                · skipped <b>{result.duplicates}</b> duplicate{result.duplicates === 1 ? "" : "s"}
              </>
            )}
            {result.failed > 0 && (
              <>
                {" "}
                · <b className="text-rose-600">{result.failed}</b> error
                {result.failed === 1 ? "" : "s"}
              </>
            )}
          </p>
          {result.errors.length > 0 && (
            <ul className="mt-1 max-h-24 overflow-y-auto text-rose-600">
              {result.errors.slice(0, 8).map((e, i) => (
                <li key={i}>
                  {e.line > 0 ? `Row ${e.line}: ` : ""}
                  {e.message}
                </li>
              ))}
              {result.errors.length > 8 && <li>…and {result.errors.length - 8} more</li>}
            </ul>
          )}
        </div>
      )}

      <p className="text-[11px] leading-relaxed text-slate-400">
        Columns: <span className="font-mono">symbol, exchange, type, quantity, price, fees, date, note, ref</span>.
        Only <span className="font-mono">symbol</span> &amp; <span className="font-mono">quantity</span> are
        required. Re-importing the same file is safe: duplicates are skipped.
      </p>
    </form>
  );
}
