// Shared types for the CSV/manual import feature.
// Kept free of runtime imports (no papaparse) so client components can `import type` from here
// without pulling the parser into the browser bundle.

export type ParsedRow = {
  line: number; // 1-based source row (for error messages)
  symbol: string;
  exchange: string;
  type: string; // buy | sell | dividend | deposit | withdrawal
  quantity: number;
  price: number;
  fees: number;
  currency: string | null;
  executed_at: string | null; // YYYY-MM-DD, or null = default to today
  note: string | null;
  ref: string | null; // optional broker trade id (used for dedup when present)
};

export type RowError = { line: number; message: string };

export type ParseResult = { rows: ParsedRow[]; errors: RowError[] };

export type ImportResult = {
  imported: number; // newly inserted
  duplicates: number; // skipped because already present
  failed: number; // rows that couldn't be parsed or resolved
  total: number; // valid rows parsed
  errors: RowError[];
};
