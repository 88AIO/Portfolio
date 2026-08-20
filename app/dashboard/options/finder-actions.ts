"use server";

import { createClient } from "@/lib/supabase/server";
import { getQuote, getOptionChain } from "@/lib/marketdata";
import type { FinderRow, FinderResult } from "@/lib/options";

// A small, liquid, optionable US universe seeded alongside the user's own holdings.
// Bounded on purpose to stay inside free-tier data limits (see docs/COST_MODEL.md).
const DEFAULT_UNIVERSE = [
  "AAPL", "MSFT", "NVDA", "AMD", "KO", "PEP", "JPM", "XOM",
  "O", "SCHD", "QQQ", "SPY", "T", "VZ", "PFE",
];
const MAX_UNIVERSE = 14;

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

// Scan cash-secured puts ~`otmPct`% out of the money at ~`targetDte` days, ranked by
// annualized return-on-capital. Informational only — nothing here is a recommendation.
export async function scanPutFinder(input?: {
  targetDte?: number;
  otmPct?: number;
}): Promise<FinderResult> {
  const targetDte = clamp(Math.round(input?.targetDte ?? 35), 7, 90);
  const otmPct = clamp(input?.otmPct ?? 6, 0, 30);

  const supabase = await createClient();
  // Require a signed-in user: this action fans out to the option-chain provider, so an anon
  // caller shouldn't be able to drive that external cost.
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { rows: [], scanned: 0, truncated: false, targetDte, otmPct };

  const { data: pos } = await supabase
    .from("positions").select("symbol, exchange, div_yield_ttm").limit(300);

  const held = new Set<string>();
  const yieldBySym = new Map<string, number | null>();
  for (const p of (pos ?? []) as { symbol: string; exchange: string | null; div_yield_ttm: number | null }[]) {
    if ((p.exchange ?? "US").toUpperCase() === "US" && p.symbol) {
      held.add(p.symbol.toUpperCase());
      yieldBySym.set(p.symbol.toUpperCase(), p.div_yield_ttm ?? null);
    }
  }

  const full = [...new Set([...held, ...DEFAULT_UNIVERSE])];
  const universe = full.slice(0, MAX_UNIVERSE);
  const truncated = full.length > MAX_UNIVERSE;

  const rows: FinderRow[] = [];
  const batchSize = 4; // bound concurrency against the free data provider
  for (let i = 0; i < universe.length; i += batchSize) {
    const batch = universe.slice(i, i + batchSize);
    const results = await Promise.all(
      batch.map((sym) => scanOne(sym, targetDte, otmPct, held, yieldBySym))
    );
    for (const r of results) if (r) rows.push(r);
  }
  rows.sort((a, b) => b.annualizedRoC - a.annualizedRoC);
  return { rows, scanned: universe.length, truncated, targetDte, otmPct };
}

async function scanOne(
  symbol: string,
  targetDte: number,
  otmPct: number,
  held: Set<string>,
  yieldBySym: Map<string, number | null>
): Promise<FinderRow | null> {
  try {
    const q = await getQuote(symbol, "US");
    const price = q.price;
    if (!price || price <= 0) return null;

    const base = await getOptionChain(symbol, "US");
    if (!base) return null;

    const now = Date.now();
    const dteOf = (iso: string) =>
      Math.round((new Date(`${iso}T00:00:00Z`).getTime() - now) / 86400000);

    // Pick the listed expiration closest to the target DTE.
    let bestExp: string | null = base.expiration && base.contracts.length ? base.expiration : null;
    let bestDiff = bestExp ? Math.abs(dteOf(bestExp) - targetDte) : Infinity;
    for (const e of base.expirations) {
      const d = Math.abs(dteOf(e) - targetDte);
      if (d < bestDiff) {
        bestDiff = d;
        bestExp = e;
      }
    }
    if (!bestExp) return null;
    const dte = dteOf(bestExp);
    if (dte <= 0) return null;

    // Reuse the base chain if it already holds the chosen expiration, else fetch that board.
    const contracts =
      base.expiration === bestExp
        ? base.contracts
        : (await getOptionChain(symbol, "US", bestExp))?.contracts ?? [];

    const targetStrike = price * (1 - otmPct / 100);
    const puts = contracts.filter((c) => c.type === "put" && c.strike <= price);
    if (!puts.length) return null;
    puts.sort((a, b) => Math.abs(a.strike - targetStrike) - Math.abs(b.strike - targetStrike));
    const put = puts[0];

    const mark = put.mark;
    if (mark == null || mark <= 0) return null;
    const annualizedRoC = (mark / put.strike) * (365 / Math.max(dte, 1)) * 100;

    return {
      symbol,
      price,
      strike: put.strike,
      expiration: bestExp,
      dte,
      premium: mark,
      annualizedRoC,
      iv: put.iv != null ? put.iv * 100 : null,
      divYield: yieldBySym.get(symbol) ?? null,
      held: held.has(symbol),
    };
  } catch {
    return null;
  }
}
