// Market-data provider abstraction.
// Default: EODHD (https://eodhd.com) — covers 70+ exchanges incl. US + Asian markets,
// which is why it's a good fit here. Swap this file to change providers later.
//
// EODHD symbol format is SYMBOL.EXCHANGE, e.g. AAPL.US, 0700.HK, 7203.TSE.

export type Quote = {
  price: number | null;
  currency: string | null;
  changePct: number | null;
};

const EODHD_BASE = "https://eodhd.com/api";

export async function getQuote(symbol: string, exchange: string): Promise<Quote> {
  const token = process.env.EODHD_API_TOKEN;
  if (!token) {
    // No key configured yet — return empty so the app still runs.
    return { price: null, currency: null, changePct: null };
  }
  const ticker = `${symbol}.${exchange}`;
  try {
    const res = await fetch(
      `${EODHD_BASE}/real-time/${encodeURIComponent(ticker)}?api_token=${token}&fmt=json`,
      { next: { revalidate: 60 } }
    );
    if (!res.ok) return { price: null, currency: null, changePct: null };
    const d = await res.json();
    return {
      price: typeof d.close === "number" ? d.close : Number(d.close) || null,
      currency: null, // real-time endpoint doesn't return currency; taken from instrument row
      changePct: typeof d.change_p === "number" ? d.change_p : Number(d.change_p) || null,
    };
  } catch {
    return { price: null, currency: null, changePct: null };
  }
}

// FX: how many units of `base` one unit of `from` is worth. Falls back to 1.
export async function getFxRate(from: string, base: string): Promise<number> {
  if (!from || !base || from === base) return 1;
  const token = process.env.EODHD_API_TOKEN;
  if (!token) return 1;
  try {
    const res = await fetch(
      `${EODHD_BASE}/real-time/${from}${base}.FOREX?api_token=${token}&fmt=json`,
      { next: { revalidate: 3600 } }
    );
    if (!res.ok) return 1;
    const d = await res.json();
    const r = typeof d.close === "number" ? d.close : Number(d.close);
    return r && !isNaN(r) && r > 0 ? r : 1;
  } catch {
    return 1;
  }
}

// Get conversion rates for a set of currencies into the base currency.
export async function getRates(currencies: string[], base: string): Promise<Record<string, number>> {
  const uniq = [...new Set(currencies.filter(Boolean))];
  const out: Record<string, number> = {};
  await Promise.all(uniq.map(async (c) => { out[c] = await getFxRate(c, base); }));
  return out;
}

// Look up an instrument's name/type/currency when it's first added.
export async function searchInstrument(symbol: string, exchange: string) {
  const token = process.env.EODHD_API_TOKEN;
  if (!token) return null;
  try {
    const res = await fetch(
      `${EODHD_BASE}/search/${encodeURIComponent(symbol)}?api_token=${token}&fmt=json&limit=10`,
      { next: { revalidate: 86400 } }
    );
    if (!res.ok) return null;
    const list = await res.json();
    const match =
      list.find((x: { Exchange?: string }) => x.Exchange === exchange) || list[0];
    if (!match) return null;
    return {
      name: match.Name as string,
      currency: match.Currency as string,
      type: (match.Type as string)?.toLowerCase() || "stock",
    };
  } catch {
    return null;
  }
}
