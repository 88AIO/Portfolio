// CSV serialization for exports (no lock-in — your data leaves in a plain, re-importable file).
// RFC 4180 quoting: wrap a field in double quotes when it contains a comma, quote, or newline,
// and escape embedded quotes by doubling them.

export type CsvValue = string | number | null | undefined;

function cell(v: CsvValue): string {
  if (v == null) return "";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "";
  let s = String(v);
  // CSV-injection defense (string cells only, so real negative numbers are untouched): a
  // spreadsheet treats a cell starting with = + - @ (or a leading tab/CR) as a formula, so a
  // user-controlled note/symbol like "=HYPERLINK(...)" would execute on open. Prefix a single
  // quote so it's shown as text, not evaluated.
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Serialize rows (arrays of values) with a header row into a CSV string. */
export function toCsv(headers: string[], rows: CsvValue[][]): string {
  const lines = [headers.map(cell).join(",")];
  for (const row of rows) lines.push(row.map(cell).join(","));
  return lines.join("\r\n") + "\r\n";
}

/** Build the standard attachment Response for a CSV download. */
export function csvResponse(filename: string, csv: string): Response {
  return new Response(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}

/** A dated, filesystem-safe filename like "snowfolio-transactions-2026-08-19.csv". */
export function exportFilename(kind: string, today: string): string {
  return `snowfolio-${kind}-${today}.csv`;
}
