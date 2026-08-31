// Spotting a dividend that was reinvested rather than paid out in cash.
//
// There is no DRIP flag in the ledger, and there deliberately isn't a clever one. The honest
// signal is what the broker itself called the transaction: an import maps the statement's
// description column into `note`, so a reinvestment says so in its own words.
//
// The alternative — inferring DRIP by matching small fractional buys against nearby dividend dates
// — would mislabel ordinary purchases as reinvestments, and a wrongly-tagged buy is worse than an
// untagged one. A row we cannot vouch for stays unmarked.

const DRIP_PATTERN = /\b(drip|re-?invest(ed|ment)?)\b/i;

/** True when the transaction's own description says it was a reinvestment. */
export function isDripBuy(type: string, note: string | null | undefined): boolean {
  if (type !== "buy" || !note) return false;
  return DRIP_PATTERN.test(note);
}
