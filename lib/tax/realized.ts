// Realized-gains engine — FIFO lot matching from the transaction ledger (source of truth).
// Snowball has no realized-gain/tax reporting; this is one of Snowfolio's named edges.
//
// Track & inform, not tax advice: this is a plain FIFO cost-basis match. It does NOT model wash
// sales, lot-relief methods other than FIFO, per-share commissions beyond what's on the trade,
// return-of-capital adjustments, or the special tax treatment of options — the UI says so plainly.

export type LedgerTx = {
  symbol: string;
  // Optional, but pass it when you have it: a ticker string alone does not identify an instrument.
  exchange?: string | null;
  currency: string;
  type: string; // buy | sell | dividend | deposit | withdrawal
  quantity: number;
  price: number;
  fees: number;
  executed_at: string; // YYYY-MM-DD
};

export type RealizedLot = {
  symbol: string;
  currency: string;
  quantity: number;
  openDate: string;
  closeDate: string;
  proceeds: number; // native currency, net of the sale's fees
  costBasis: number; // native currency, incl. the buy's fees
  gain: number; // proceeds − costBasis
  longTerm: boolean; // held ≥ 1 year (US long-term threshold)
};

type OpenLot = { qty: number; costPerShare: number; date: string };

/**
 * Long-term when held MORE than one calendar year (US).
 *
 * IRS Pub. 550: the holding period begins the day AFTER acquisition and includes the day of
 * disposal, and a gain is long-term only if the property was held more than one year — so a sale
 * ON the one-year anniversary is still short-term. A day-count rule gets this wrong twice: it
 * calls the anniversary long-term, and it misjudges any period spanning a leap day, where one
 * calendar year is 366 days. Long-term rates are lower, so both errors understate the tax owed.
 *
 * Compare calendar anniversaries instead of counting days. A Feb-29 purchase has no Feb-29
 * anniversary; it rolls to Mar 1, which keeps the sale short-term a day longer — the conservative
 * direction.
 */
function isLongTerm(openDate: string, closeDate: string): boolean {
  const open = new Date(`${openDate}T00:00:00Z`);
  if (Number.isNaN(open.getTime())) return false;
  const anniversary = Date.UTC(open.getUTCFullYear() + 1, open.getUTCMonth(), open.getUTCDate());
  return Date.parse(`${closeDate}T00:00:00Z`) > anniversary;
}

// Process buys before sells on the same day so a same-day round trip matches correctly.
function order(a: LedgerTx, b: LedgerTx): number {
  if (a.executed_at !== b.executed_at) return a.executed_at.localeCompare(b.executed_at);
  const rank = (t: string) => (t === "buy" ? 0 : t === "sell" ? 1 : 2);
  return rank(a.type) - rank(b.type);
}

/**
 * Match sells against prior buys FIFO and emit one realized lot per matched slice.
 * Only buy/sell transactions matter; dividends/cash movements are ignored here.
 */
export function computeRealizedLots(txs: LedgerTx[]): RealizedLot[] {
  // Group by INSTRUMENT, not by ticker string. A dual-listed name shares its ticker across venues
  // (a London line in GBP, a US line in USD), and matching a GBP buy against a USD sell produces a
  // cost basis that is arithmetic nonsense — which the tax page then converts at the sell
  // currency's FX rate, compounding it. Currency is the field that always distinguishes them;
  // exchange refines it further when the caller supplies it.
  const byInstrument = new Map<string, { symbol: string; txs: LedgerTx[] }>();
  for (const t of txs) {
    if (t.type !== "buy" && t.type !== "sell") continue;
    const key = `${t.symbol}\u0000${t.exchange ?? ""}\u0000${t.currency}`;
    const entry = byInstrument.get(key) ?? { symbol: t.symbol, txs: [] };
    entry.txs.push(t);
    byInstrument.set(key, entry);
  }

  const lots: RealizedLot[] = [];
  for (const { symbol, txs: list } of byInstrument.values()) {
    const open: OpenLot[] = [];
    for (const t of [...list].sort(order)) {
      const qty = Math.abs(t.quantity);
      if (qty <= 0) continue;

      if (t.type === "buy") {
        const costPerShare = (qty * t.price + (t.fees || 0)) / qty; // fees fold into basis
        open.push({ qty, costPerShare, date: t.executed_at });
        continue;
      }

      // sell: consume open lots FIFO. Allocate the sale's fees across the sold shares.
      let remaining = qty;
      const sellFeePerShare = (t.fees || 0) / qty;
      while (remaining > 0 && open.length > 0) {
        const lot = open[0];
        const take = Math.min(remaining, lot.qty);
        const proceeds = take * t.price - take * sellFeePerShare;
        const costBasis = take * lot.costPerShare;
        lots.push({
          symbol,
          currency: t.currency,
          quantity: take,
          openDate: lot.date,
          closeDate: t.executed_at,
          proceeds,
          costBasis,
          gain: proceeds - costBasis,
          longTerm: isLongTerm(lot.date, t.executed_at),
        });
        lot.qty -= take;
        remaining -= take;
        if (lot.qty <= 1e-9) open.shift();
      }
      // Oversold with no matching lot (e.g. a short or a data gap): realize with zero basis so
      // the proceeds still appear rather than silently vanishing.
      if (remaining > 1e-9) {
        const proceeds = remaining * t.price - remaining * sellFeePerShare;
        lots.push({
          symbol,
          currency: t.currency,
          quantity: remaining,
          openDate: t.executed_at,
          closeDate: t.executed_at,
          proceeds,
          costBasis: 0,
          gain: proceeds,
          longTerm: false,
        });
      }
    }
  }

  return lots.sort((a, b) => a.closeDate.localeCompare(b.closeDate) || a.symbol.localeCompare(b.symbol));
}

export type RealizedSummary = {
  shortTermGain: number; // base currency
  longTermGain: number;
  totalGain: number;
  proceeds: number;
  costBasis: number;
  lotCount: number;
};

/** Roll matched lots into a base-currency summary. `fx(ccy)` → base multiplier. */
export function summarizeRealized(
  lots: RealizedLot[],
  fx: (ccy: string) => number
): RealizedSummary {
  let shortTermGain = 0, longTermGain = 0, proceeds = 0, costBasis = 0;
  for (const l of lots) {
    const r = fx(l.currency);
    if (l.longTerm) longTermGain += l.gain * r;
    else shortTermGain += l.gain * r;
    proceeds += l.proceeds * r;
    costBasis += l.costBasis * r;
  }
  return {
    shortTermGain,
    longTermGain,
    totalGain: shortTermGain + longTermGain,
    proceeds,
    costBasis,
    lotCount: lots.length,
  };
}

/** Filter lots to those CLOSED within a given calendar year (the taxable event's year). */
export function lotsInYear(lots: RealizedLot[], year: number): RealizedLot[] {
  const y = String(year);
  return lots.filter((l) => l.closeDate.slice(0, 4) === y);
}

/** Distinct close-years present in the lots, newest first — for a year picker. */
export function realizedYears(lots: RealizedLot[]): number[] {
  const years = new Set<number>();
  for (const l of lots) years.add(Number(l.closeDate.slice(0, 4)));
  return [...years].sort((a, b) => b - a);
}
