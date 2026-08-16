// EODHD provider (https://eodhd.com) — the paid, scale-up option.
// Covers 70+ exchanges incl. US + Asian markets. Selected when MARKET_DATA_PROVIDER=eodhd.
// EODHD symbol format is SYMBOL.EXCHANGE, e.g. AAPL.US, 0700.HK, 7203.TSE.
import type { InstrumentMeta, MarketDataProvider, Quote } from "../types";

const EODHD_BASE = "https://eodhd.com/api";

async function getQuote(symbol: string, exchange: string): Promise<Quote> {
  const token = process.env.EODHD_API_TOKEN;
  if (!token) {
    // No key configured — return empty so the app still runs.
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
async function getFxRate(from: string, base: string): Promise<number> {
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

// Look up an instrument's name/type/currency when it's first added.
async function searchInstrument(symbol: string, exchange: string): Promise<InstrumentMeta | null> {
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
      name: (match.Name as string) ?? symbol,
      currency: (match.Currency as string) ?? "USD",
      type: (match.Type as string)?.toLowerCase() || "stock",
    };
  } catch {
    return null;
  }
}

export const eodhdProvider: MarketDataProvider = {
  name: "eodhd",
  capabilities: { options: false },
  getQuote,
  getFxRate,
  searchInstrument,
};
