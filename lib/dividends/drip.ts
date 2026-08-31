// Spotting a dividend that was reinvested rather than paid out in cash.
//
// Two honest signals, in order:
//   1. The `drip` flag the user set on the transaction. Explicit, and the only option for a ledger
//      imported from a broker whose export dropped the description column.
//   2. What the broker itself called it — imports map the statement's description into `note`, so
//      a reinvestment often says so in its own words.
//
// What is deliberately NOT a signal: small fractional buys landing near a dividend date. That
// heuristic mislabels ordinary purchases, and a wrongly tagged buy is worse than an untagged one.
// A row we cannot vouch for stays unmarked.

const DRIP_PATTERN = /\b(drip|re-?invest(ed|ment)?)\b/i;

/** True when the user marked the buy as reinvested, or its own description says so. */
export function isDripBuy(
  type: string,
  note: string | null | undefined,
  flag?: boolean | null
): boolean {
  if (type !== "buy") return false;
  if (flag) return true;
  return !!note && DRIP_PATTERN.test(note);
}
