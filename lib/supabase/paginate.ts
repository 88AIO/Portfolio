// Supabase/PostgREST caps a single response at ~1000 rows. Any unfiltered read of a table that can
// grow past that (transactions, price_history) silently returns only the first page — dropping the
// rest and corrupting anything computed from the full set. fetchAll pages through the whole result.
//
// Pass a builder that applies .range(from, to) to your query and resolves to { data }. Always add a
// stable, total ordering (e.g. .order("date").order("id")) before calling, so pages don't overlap or
// skip rows across the boundary.
export async function fetchAll<T>(
  build: (from: number, to: number) => PromiseLike<{ data: T[] | null }>,
  pageSize = 1000,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data } = await build(from, from + pageSize - 1);
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < pageSize) break;
  }
  return out;
}
