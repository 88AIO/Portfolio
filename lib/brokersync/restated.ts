// Rows a broker restated for us, rather than trades that happened.
//
// The broker feed only reaches back so far, so lib/brokersync/run.ts adds ONE synthetic lot per
// held instrument covering the gap between the trades it could see and the shares the broker says
// you hold now. That lot deliberately absorbs transfers-in, pre-window shares AND past splits — its
// quantity is already today's share count and its price is the broker's already-restated average
// cost.
//
// Which makes it the one kind of row that must NOT be split-adjusted again. A holding whose
// earliest visible activity predates a 10-for-1 split would otherwise be multiplied by ten a second
// time, turning a real position into a fictional one an order of magnitude larger.
//
// Identified by the dedupe_key prefix the sync writes, so no extra column is needed:
//   ref:snaptrade-recon:*  the opening-balance lot described above
//   ref:snaptrade-pos:*    the legacy whole-position snapshot it replaced

const RESTATED_PREFIXES = ["ref:snaptrade-recon:", "ref:snaptrade-pos:"];

/** True when the row's quantity is already expressed in today's shares. */
export function isBrokerRestated(dedupeKey: string | null | undefined): boolean {
  if (!dedupeKey) return false;
  return RESTATED_PREFIXES.some((p) => dedupeKey.startsWith(p));
}

/**
 * True when a dividend row holds the whole cash payment rather than a per-share rate.
 *
 * SnapTrade reports a dividend as an amount, not a rate, so the sync stores it as quantity 1 ×
 * price = the cash received (see providers/snaptrade.ts). Totals built from quantity × price come
 * out right, but anything printing `price` as a per-share figure claims NVDA paid $64 a share.
 * Manually added and CSV-imported dividends keep the real shares × rate shape, so the two have to
 * be told apart before either is displayed.
 */
export function isBrokerCashDividend(
  type: string,
  dedupeKey: string | null | undefined
): boolean {
  return type === "dividend" && !!dedupeKey && dedupeKey.startsWith("ref:snaptrade-act:");
}
