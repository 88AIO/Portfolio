// A batch insert/upsert to Supabase (PostgREST) requires every row in the array to declare the
// SAME set of columns. A row that omits a key is not defaulted per-row — PostgREST unions the keys
// across the whole array and sends an explicit NULL for any row missing one. So a single row that
// conditionally includes an extra key (e.g. a boolean sent only when true) silently turns every
// OTHER row's value for that key into NULL, and if the column is NOT NULL, Postgres rejects the
// ENTIRE batch — with a message that names the column but not which row, or why.
//
// This exact shape mismatch once took down a real account's whole equity import: a `drip` column,
// sent only on reinvestment rows, failed every other row in the same batch, and the fallback that
// followed replaced real, dated purchase history with a same-day guess. See
// lib/brokersync/run.ts — importEquityHistory.
//
// Call this immediately before any multi-row insert/upsert into a NOT-NULL-constrained table. It
// turns that failure mode into an immediate, specific, loud error at the call site — naming the
// row and the missing keys — instead of a generic constraint violation discovered downstream, and
// instead of Postgres silently accepting a batch that quietly NULLs out real data.
export function assertUniformRowShape(rows: readonly Record<string, unknown>[], label: string): void {
  if (rows.length < 2) return;
  const first = Object.keys(rows[0]).sort();
  const firstKey = first.join(",");
  for (let i = 1; i < rows.length; i++) {
    const keys = Object.keys(rows[i]).sort();
    const key = keys.join(",");
    if (key !== firstKey) {
      const missing = first.filter((k) => !keys.includes(k));
      const extra = keys.filter((k) => !first.includes(k));
      throw new Error(
        `${label}: row ${i} has different columns than row 0` +
          (missing.length ? ` — missing ${missing.join(", ")}` : "") +
          (extra.length ? ` — has extra ${extra.join(", ")}` : "") +
          ". Every row in a batch insert must set the same keys, or PostgREST sends NULL for the ones a row omits."
      );
    }
  }
}
