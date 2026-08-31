// Stock splits, and restating history in today's shares.
//
// A split changes how many pieces you hold, never what you paid or what you were paid. Ten shares
// bought at $500 become forty at $125 after a 4-for-1: the same $5,000. Get this wrong and the
// damage is not cosmetic — the holding shows a quarter of its real share count against a
// present-day price, which prints a large phantom loss, and every number downstream (cost basis,
// return, realized gains, the value chart) inherits it.
//
// The user's ledger is never rewritten to account for one. Their transactions have to keep saying
// what their broker statement says, or reconciliation breaks and the import dedupe key stops
// matching — which would re-import every pre-split trade as a duplicate. Splits live in their own
// reference table and are applied at read time, here and in the positions view. The two must agree:
// supabase/schema.sql carries the SQL twin of splitFactor().

export type Split = {
  exDate: string; // YYYY-MM-DD — the first session that trades at the new share count
  ratio: number; // 4 = 4-for-1 forward; 0.1 = 1-for-10 reverse
};

/**
 * How many of today's shares one share recorded on `date` has become.
 *
 * Only splits strictly AFTER the date apply: a trade executed ON the ex-date already prices and
 * counts in post-split shares, so counting that split again would double it. Multiple splits
 * compose (2-for-1 then 3-for-1 is 6x).
 *
 * Returns 1 — a no-op — for an unknown date or an empty history, so a caller with no split data
 * behaves exactly as it did before splits existed.
 */
export function splitFactor(splits: Split[] | undefined, date: string): number {
  if (!splits?.length || !date) return 1;
  let factor = 1;
  for (const s of splits) {
    // A non-positive ratio would multiply a share count into nonsense. The table rejects one, but
    // this module is also fed by importers and providers, so it defends itself.
    if (!(s.ratio > 0) || !Number.isFinite(s.ratio)) continue;
    if (s.exDate > date) factor *= s.ratio;
  }
  return factor;
}

/**
 * Restate a quantity and its per-share price in today's terms.
 *
 * The pair moves together and in opposite directions, which is the whole point: quantity x price is
 * unchanged, so any money computed from the result stays correct while the share count becomes
 * comparable to today's price.
 */
export function adjustQuantityPrice(
  quantity: number,
  price: number,
  splits: Split[] | undefined,
  date: string
): { quantity: number; price: number } {
  const f = splitFactor(splits, date);
  if (f === 1) return { quantity, price };
  return { quantity: quantity * f, price: price / f };
}

/**
 * Restate a historical per-share dividend in today's shares.
 *
 * Providers report a payout as it was announced, so a pre-split $0.82 sits in the same series as a
 * post-split $0.24. Left alone, a 4-for-1 split reads as a 75% dividend cut — which is precisely
 * the signal the safety score is built to detect, so it would confidently score a healthy payer as
 * dangerous. Dividing by the split factor puts every payment on the same per-share footing.
 */
export function adjustDividendPerShare(
  amount: number,
  splits: Split[] | undefined,
  exDate: string
): number {
  const f = splitFactor(splits, exDate);
  return f === 1 ? amount : amount / f;
}

/** Group a flat list of split rows by instrument, ascending by date — the shape readers want. */
export function groupSplitsByInstrument<T extends { instrument_id: string; ex_date: string | null; ratio: number | null }>(
  rows: T[]
): Map<string, Split[]> {
  const out = new Map<string, Split[]>();
  for (const r of rows) {
    if (!r.ex_date || r.ratio == null || !(r.ratio > 0)) continue;
    const arr = out.get(r.instrument_id) ?? [];
    arr.push({ exDate: r.ex_date, ratio: r.ratio });
    out.set(r.instrument_id, arr);
  }
  for (const arr of out.values()) arr.sort((a, b) => a.exDate.localeCompare(b.exDate));
  return out;
}
