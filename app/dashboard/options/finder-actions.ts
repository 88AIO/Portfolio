"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getQuote, getOptionChain, providerSupportsOptions } from "@/lib/marketdata";
import type { FinderRow, FinderResult } from "@/lib/options";
import { dividendSafety, type DividendPoint } from "@/lib/dividends/safety";
import { computeIvRank, IV_RANK_WINDOW_DAYS, type IvSample } from "@/lib/options/iv-rank";
import { FINDER_UNIVERSE, FINDER_MAX_UNIVERSE } from "@/lib/options/finder-universe";
import { todayIso } from "@/lib/date";

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

// A raw scan result before IV-rank / dividend-safety enrichment (those need DB history).
type RawScan = Omit<FinderRow, "ivRank" | "ivBuilding" | "safetyScore" | "safetyBand" | "safetyLabel">;

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

  // Not every provider sells option chains (EODHD gates them behind a separate marketplace
  // add-on). Say so up front rather than scanning: every symbol would come back null and the
  // result would look identical to a thin market. Checked before the scan cache too, so a scan
  // cached under a provider that had chains isn't replayed under one that doesn't.
  if (!providerSupportsOptions()) {
    return { rows: [], scanned: 0, truncated: false, targetDte, otmPct, optionsUnavailable: true };
  }

  const { data: pos } = await supabase
    .from("positions").select("symbol, exchange").limit(300);

  const held = new Set<string>();
  for (const p of (pos ?? []) as { symbol: string; exchange: string | null }[]) {
    if ((p.exchange ?? "US").toUpperCase() === "US" && p.symbol) held.add(p.symbol.toUpperCase());
  }

  const full = [...new Set([...held, ...FINDER_UNIVERSE])];
  const universe = full.slice(0, FINDER_MAX_UNIVERSE);
  const truncated = full.length > FINDER_MAX_UNIVERSE;

  const today = todayIso();
  const admin = createAdminClient();

  // Shared scan cache: identical (dte, otm, universe) scans within the TTL are served from the
  // finder_scans table instead of re-fanning out to the option-chain provider — this bounds the
  // app's spikiest provider consumer to ~one full scan per TTL globally, however many users click.
  // Scans are informational (not live trading data), so 10-minute staleness is acceptable.
  // Best-effort on both sides: a missing table (migration not applied yet) must never break a scan.
  const scanKey = `${targetDte}:${otmPct}:${universe.join(",")}`;
  const SCAN_TTL_MS = 10 * 60_000;
  try {
    const { data: cached } = await admin
      .from("finder_scans").select("result, created_at").eq("scan_key", scanKey).maybeSingle();
    if (cached?.result && Date.now() - new Date(cached.created_at).getTime() < SCAN_TTL_MS) {
      return cached.result as FinderResult;
    }
  } catch { /* cache miss path — scan live */ }

  // Reference data for the whole universe in one round-trip each: current yield + instrument id
  // (for dividend history), the dividend history itself, and stored IV samples for IV-rank.
  const { data: instRows } = await admin
    .from("instruments")
    .select("id, symbol, div_yield_ttm")
    .in("symbol", universe)
    .eq("exchange", "US");

  const instBySym = new Map<string, { id: string; yield: number | null }>();
  const idToSym = new Map<string, string>();
  for (const r of (instRows ?? []) as { id: string; symbol: string; div_yield_ttm: number | null }[]) {
    const sym = r.symbol.toUpperCase();
    instBySym.set(sym, { id: r.id, yield: r.div_yield_ttm });
    idToSym.set(r.id, sym);
  }

  const instIds = [...idToSym.keys()];
  const divHistBySym = new Map<string, DividendPoint[]>();
  if (instIds.length) {
    const { data: divRows } = await admin
      .from("dividends").select("instrument_id, ex_date, amount").in("instrument_id", instIds);
    for (const d of (divRows ?? []) as { instrument_id: string; ex_date: string | null; amount: number | null }[]) {
      const sym = idToSym.get(d.instrument_id);
      if (!sym || !d.ex_date || d.amount == null) continue;
      const arr = divHistBySym.get(sym) ?? [];
      arr.push({ exDate: d.ex_date, amount: d.amount });
      divHistBySym.set(sym, arr);
    }
  }

  const windowStart = new Date(Date.now() - IV_RANK_WINDOW_DAYS * 86_400_000).toISOString().slice(0, 10);
  const { data: ivRows } = await admin
    .from("iv_history")
    .select("symbol, captured_on, iv")
    .in("symbol", universe)
    .eq("exchange", "US")
    .gte("captured_on", windowStart);
  const ivHistBySym = new Map<string, IvSample[]>();
  for (const s of (ivRows ?? []) as { symbol: string; captured_on: string; iv: number }[]) {
    const sym = s.symbol.toUpperCase();
    const arr = ivHistBySym.get(sym) ?? [];
    arr.push({ captured_on: s.captured_on, iv: s.iv });
    ivHistBySym.set(sym, arr);
  }

  // Serve underlying prices from the shared price_cache when fresh — the nightly sync and
  // refreshPrices keep it current, so re-quoting each name per scan is pure duplicate provider load
  // (~40% of a scan's calls). Stale/missing entries still get a live quote inside scanOne.
  const QUOTE_FRESH_MS = 15 * 60_000;
  const freshPriceBySym = new Map<string, number>();
  if (instIds.length) {
    const { data: pcRows } = await admin
      .from("price_cache").select("instrument_id, price, as_of").in("instrument_id", instIds);
    for (const pc of (pcRows ?? []) as { instrument_id: string; price: number | null; as_of: string | null }[]) {
      const sym = idToSym.get(pc.instrument_id);
      if (!sym || !pc.price || pc.price <= 0 || !pc.as_of) continue;
      if (Date.now() - new Date(pc.as_of).getTime() < QUOTE_FRESH_MS) freshPriceBySym.set(sym, pc.price);
    }
  }

  // Fan out to the option-chain provider (bounded concurrency).
  const raws: RawScan[] = [];
  const batchSize = 4;
  for (let i = 0; i < universe.length; i += batchSize) {
    const batch = universe.slice(i, i + batchSize);
    const results = await Promise.all(
      batch.map((sym) =>
        scanOne(sym, targetDte, otmPct, held, instBySym.get(sym)?.yield ?? null, freshPriceBySym.get(sym) ?? null)
      )
    );
    for (const r of results) if (r) raws.push(r);
  }

  // Persist today's IV reading for each scanned name so the trailing IV range keeps building.
  const samples = raws
    .filter((r) => r.iv != null)
    .map((r) => ({ symbol: r.symbol.toUpperCase(), exchange: "US", captured_on: today, iv: r.iv as number }));
  if (samples.length) {
    await admin.from("iv_history").upsert(samples, { onConflict: "symbol,exchange,captured_on" });
  }

  // Enrich each raw scan with an IV-rank (from stored history + today's reading) and a
  // dividend-safety read (from the synced payout history). Both fail honestly to "unknown".
  const rows: FinderRow[] = raws.map((r) => {
    const sym = r.symbol.toUpperCase();
    const ir = computeIvRank(ivHistBySym.get(sym) ?? [], r.iv, today);
    const safety = dividendSafety(divHistBySym.get(sym) ?? [], r.divYield);
    return {
      ...r,
      ivRank: ir.rank,
      ivBuilding: ir.building,
      safetyScore: safety.score,
      safetyBand: safety.band,
      safetyLabel: safety.label,
    };
  });

  rows.sort((a, b) => b.annualizedRoC - a.annualizedRoC);
  const result: FinderResult = { rows, scanned: universe.length, truncated, targetDte, otmPct };
  try {
    await admin.from("finder_scans").upsert(
      { scan_key: scanKey, result, created_at: new Date().toISOString() },
      { onConflict: "scan_key" }
    );
  } catch { /* best-effort — a failed cache write never fails the scan */ }
  return result;
}

async function scanOne(
  symbol: string,
  targetDte: number,
  otmPct: number,
  held: Set<string>,
  divYield: number | null,
  cachedPrice: number | null
): Promise<RawScan | null> {
  try {
    // A fresh shared-cache price skips the per-scan quote call; otherwise quote live.
    const price = cachedPrice ?? (await getQuote(symbol, "US")).price;
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
    // The tradeable row: the put nearest the requested %-OTM strike.
    const byOtm = [...puts].sort((a, b) => Math.abs(a.strike - targetStrike) - Math.abs(b.strike - targetStrike));
    const put = byOtm[0];

    const mark = put.mark;
    if (mark == null || mark <= 0) return null;
    const annualizedRoC = (mark / put.strike) * (365 / Math.max(dte, 1)) * 100;

    // The IV we store & rank is the near-the-money put's IV at this expiration — a stable
    // reference point, so today's reading is comparable to past ones regardless of the %-OTM slider.
    const atm = [...puts].sort((a, b) => Math.abs(a.strike - price) - Math.abs(b.strike - price))[0];
    const refIv = atm.iv ?? put.iv;

    return {
      symbol,
      price,
      strike: put.strike,
      expiration: bestExp,
      dte,
      premium: mark,
      annualizedRoC,
      iv: refIv != null ? refIv * 100 : null,
      divYield,
      held: held.has(symbol),
    };
  } catch {
    return null;
  }
}
