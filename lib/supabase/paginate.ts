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

// Like fetchAll, but when the total row count is already known, fetches every page CONCURRENTLY
// instead of one-after-another. For large reads (e.g. years of weekly prices, ~20 pages) this turns
// ~20 sequential round-trips into one count query plus one burst of parallel requests. Same stable
// ordering requirement as fetchAll so pages don't overlap or skip at the boundaries.
export async function fetchAllParallel<T>(
  build: (from: number, to: number) => PromiseLike<{ data: T[] | null }>,
  total: number,
  pageSize = 1000,
): Promise<T[]> {
  if (total <= 0) return [];
  const pages = Math.ceil(total / pageSize);
  const results = await Promise.all(
    Array.from({ length: pages }, (_, i) => build(i * pageSize, i * pageSize + pageSize - 1)),
  );
  return results.flatMap((r) => r.data ?? []);
}
