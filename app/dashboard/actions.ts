"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getQuote, searchInstrument, getDividendInfo, getDividendHistory, getPriceHistory } from "@/lib/marketdata";
import { enrichInstrumentProfile } from "@/lib/enrich";
import {
  parseTransactionsCsv,
  transactionDedupeKey,
  isValidSymbol,
  isValidExchange,
  IMPORT_MAX_BYTES,
  IMPORT_MAX_ROWS,
  IMPORT_MAX_SYMBOLS,
} from "@/lib/import/csv";
import type { ImportResult } from "@/lib/import/types";

// Local date as YYYY-MM-DD — used for explicit executed_at and stable dedupe keys.
function todayIso(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

// Backfill ~13 months of weekly closes for an instrument, so the performance chart can draw
// value-over-time from cached data (service role; shared reference table).
async function syncInstrumentPriceHistory(
  admin: ReturnType<typeof createAdminClient>,
  instrumentId: string,
  symbol: string,
  exchange: string
) {
  const history = await getPriceHistory(symbol, exchange, 400);
  if (!history.length) return;
  await admin.from("price_history").upsert(
    history.map((h) => ({ instrument_id: instrumentId, d: h.date, close: h.close })),
    { onConflict: "instrument_id,d" }
  );
}

// Infer payout frequency from the spacing between recent ex-dates, snapped to a standard
// cadence — more stable than counting payments in a rolling 366-day window (which flickers
// between e.g. 3/4/5 for a quarterly payer as the boundary crosses a payment).
function inferDivFrequency(history: { exDate: string; amount: number }[]): number | null {
  if (history.length < 2) return history.length || null;
  const recent = history.slice(-9); // up to 8 gaps
  const gaps: number[] = [];
  for (let i = 1; i < recent.length; i++) {
    const days = (Date.parse(recent[i].exDate) - Date.parse(recent[i - 1].exDate)) / 86_400_000;
    if (days > 0) gaps.push(days);
  }
  if (!gaps.length) return null;
  gaps.sort((a, b) => a - b);
  const medianGap = gaps[Math.floor(gaps.length / 2)];
  const perYear = 365 / medianGap;
  const cadences = [1, 2, 4, 6, 12, 26, 52];
  return cadences.reduce((best, c) => (Math.abs(c - perYear) < Math.abs(best - perYear) ? c : best), cadences[0]);
}

// Sync an instrument's dividend reference + history from the market-data provider (service role).
async function syncInstrumentDividends(
  admin: ReturnType<typeof createAdminClient>,
  instrumentId: string,
  symbol: string,
  exchange: string,
  currency: string
) {
  const [info, history] = await Promise.all([
    getDividendInfo(symbol, exchange),
    getDividendHistory(symbol, exchange),
  ]);
  const patch: Record<string, unknown> = {};
  if (info) {
    patch.div_yield_ttm = info.yieldTtm;
    patch.ex_dividend_date = info.exDividendDate;
    patch.next_dividend_date = info.nextDividendDate;
  }

  let ttmSum = 0;
  if (history.length) {
    await admin.from("dividends").upsert(
      history.map((h) => ({ instrument_id: instrumentId, ex_date: h.exDate, amount: h.amount, currency })),
      { onConflict: "instrument_id,ex_date" }
    );
    const now = Date.now();
    const last12 = history.filter((h) => now - new Date(h.exDate).getTime() < 366 * 24 * 60 * 60 * 1000);
    ttmSum = last12.reduce((s, h) => s + (h.amount || 0), 0);
    patch.div_frequency = inferDivFrequency(history);
    patch.next_dividend_per_share = history[history.length - 1].amount;
  }

  // Annual dividend per share — honest, forward-looking, and never inflated across a cut:
  //  • Prefer Yahoo's forward "dividendRate" when present — it already reflects announced changes.
  //  • Otherwise use the trailing-12-month actual (always populated for distribution ETFs like
  //    SCHD/JEPQ/QYLD where the forward rate is missing) — BUT if the most recent payment run-rate
  //    has dropped materially below TTM (a cut), use the lower run-rate so we don't cling to the
  //    stale pre-cut figure. We no longer take max(forward, ttm), which biased income upward.
  const forward = info?.annualDividendPerShare ?? null;
  const freq = (patch.div_frequency as number | null) ?? null;
  const lastPayment = history.length ? history[history.length - 1].amount : 0;
  const recentRunRate = freq && lastPayment > 0 ? lastPayment * freq : 0;
  let annual: number | null;
  if (forward && forward > 0) {
    annual = forward;
  } else if (ttmSum > 0) {
    annual = recentRunRate > 0 && recentRunRate < ttmSum * 0.8 ? recentRunRate : ttmSum;
  } else {
    annual = forward;
  }
  if (annual != null) patch.annual_div_per_share = annual;

  if (Object.keys(patch).length) {
    await admin.from("instruments").update(patch).eq("id", instrumentId);
  }
}

// Get the user's default portfolio, creating one on first use.
export async function ensurePortfolio() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: existing } = await supabase
    .from("portfolios").select("*").eq("user_id", user.id).order("created_at").limit(1);
  if (existing && existing.length) return existing[0];

  const { data: created } = await supabase
    .from("portfolios").insert({ user_id: user.id, name: "My Portfolio" }).select().single();
  return created;
}

// Add a buy/sell/dividend transaction. Creates the instrument row if new.
export async function addTransaction(formData: FormData) {
  const supabase = await createClient();
  const admin = createAdminClient();

  const symbol = String(formData.get("symbol") || "").trim().toUpperCase();
  const exchange = String(formData.get("exchange") || "US").trim().toUpperCase();
  const type = String(formData.get("type") || "buy");
  const quantity = Number(formData.get("quantity") || 0);
  const price = Number(formData.get("price") || 0);
  const executed_at = String(formData.get("executed_at") || "") || undefined;
  if (!symbol || quantity <= 0) return;
  // Reject malformed tickers before they create junk reference rows / provider calls.
  if (!isValidSymbol(symbol) || !isValidExchange(exchange)) return;

  const portfolio = await ensurePortfolio();

  // Find or create the instrument (shared reference table, written with service role)
  let { data: inst } = await admin
    .from("instruments").select("*").eq("symbol", symbol).eq("exchange", exchange).maybeSingle();
  if (!inst) {
    const meta = await searchInstrument(symbol, exchange);
    const { data: newInst } = await admin.from("instruments").insert({
      symbol, exchange, name: meta?.name ?? symbol,
      currency: meta?.currency ?? "USD", type: meta?.type ?? "stock",
    }).select().single();
    inst = newInst;
  }
  if (!inst) return;

  const date = executed_at || todayIso();
  const dedupe_key = transactionDedupeKey({
    ref: null, type, instrument_id: inst.id, executed_at: date, quantity, price, fees: 0,
  });
  await supabase.from("transactions").upsert(
    {
      portfolio_id: portfolio.id, instrument_id: inst.id, type,
      quantity, price, fees: 0, currency: inst.currency, executed_at: date, dedupe_key,
    },
    { onConflict: "portfolio_id,dedupe_key", ignoreDuplicates: true }
  );

  // Fetch a fresh price + full dividend sync for this instrument right away.
  const q = await getQuote(symbol, exchange);
  if (q.price != null) {
    await admin.from("price_cache").upsert({
      instrument_id: inst.id, price: q.price, currency: inst.currency,
      change_pct: q.changePct, as_of: new Date().toISOString(),
    });
  }
  await syncInstrumentDividends(admin, inst.id, symbol, exchange, inst.currency);
  await syncInstrumentPriceHistory(admin, inst.id, symbol, exchange);

  revalidatePath("/dashboard");
  revalidatePath("/dashboard/performance");
}

// Refresh live prices for every instrument the user holds.
export async function refreshPrices() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login"); // don't let anon calls drive provider fan-out

  const admin = createAdminClient();
  const { data: pos } = await supabase
    .from("positions").select("instrument_id, symbol, exchange, name, currency, sector, sector_weights, type");
  if (!pos) return;

  // Pass 0 — backfill company names for holdings that still show a bare ticker (e.g. broker-synced
  // intl positions whose brokerage feed gave no description). Look the name up from the market-data
  // provider, which carries clean company names, and only for the ones missing it. Automatic on
  // every refresh, idempotent once named.
  const needName = pos.filter((p) => !p.name || p.name.trim() === "" || p.name === p.symbol);
  for (let i = 0; i < needName.length; i += 6) {
    await Promise.all(
      needName.slice(i, i + 6).map(async (p) => {
        const meta = await searchInstrument(p.symbol, p.exchange);
        if (meta?.name && meta.name !== p.symbol) {
          await admin.from("instruments").update({ name: meta.name }).eq("id", p.instrument_id);
        }
      })
    );
  }

  // Pass 1 — sector enrichment first (stocks get a single sector; ETFs get a look-through
  // breakdown), only for holdings still missing both, so it commits even if the heavier
  // price/dividend pass runs long.
  const toEnrich = pos.filter((p) => !p.sector && !p.sector_weights);
  for (let i = 0; i < toEnrich.length; i += 6) {
    await Promise.all(
      toEnrich.slice(i, i + 6).map((p) =>
        enrichInstrumentProfile(admin, {
          id: p.instrument_id, symbol: p.symbol, exchange: p.exchange, type: p.type,
        })
      )
    );
  }

  // Pass 2 — prices + dividends (heavier), batched to bound concurrency.
  for (let i = 0; i < pos.length; i += 5) {
    await Promise.all(
      pos.slice(i, i + 5).map(async (p) => {
        const q = await getQuote(p.symbol, p.exchange);
        if (q.price != null) {
          await admin.from("price_cache").upsert({
            instrument_id: p.instrument_id, price: q.price,
            change_pct: q.changePct, as_of: new Date().toISOString(),
          });
        }
        await syncInstrumentDividends(admin, p.instrument_id, p.symbol, p.exchange, p.currency);
        await syncInstrumentPriceHistory(admin, p.instrument_id, p.symbol, p.exchange);
      })
    );
  }
  revalidatePath("/dashboard");
  revalidatePath("/dashboard/performance");
}

// Import buy/sell/dividend transactions from a CSV file. Idempotent: re-importing the
// same rows is a no-op (dedupe on broker ref when present, else a natural key of the trade).
export async function importTransactions(formData: FormData): Promise<ImportResult> {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { imported: 0, duplicates: 0, failed: 0, total: 0, errors: [{ line: 0, message: "No file provided." }] };
  }
  // Bound memory + the post-import provider fan-out before reading the file into memory.
  if (file.size > IMPORT_MAX_BYTES) {
    return { imported: 0, duplicates: 0, failed: 0, total: 0, errors: [{ line: 0, message: `File too large (max ${Math.round(IMPORT_MAX_BYTES / 1e6)} MB).` }] };
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { rows, errors } = parseTransactionsCsv(await file.text());
  if (rows.length === 0) {
    return { imported: 0, duplicates: 0, failed: errors.length, total: 0, errors };
  }
  if (rows.length > IMPORT_MAX_ROWS) {
    return { imported: 0, duplicates: 0, failed: rows.length, total: rows.length, errors: [{ line: 0, message: `Too many rows (${rows.length}); max ${IMPORT_MAX_ROWS} per import.` }] };
  }

  const admin = createAdminClient();
  const portfolio = await ensurePortfolio();

  // Resolve each unique (symbol, exchange) to an instrument once (creating new ones).
  const instByKey = new Map<string, { id: string; currency: string }>();
  const uniqueKeys = [...new Set(rows.map((r) => `${r.symbol}|${r.exchange}`))];
  if (uniqueKeys.length > IMPORT_MAX_SYMBOLS) {
    return { imported: 0, duplicates: 0, failed: rows.length, total: rows.length, errors: [{ line: 0, message: `Too many distinct symbols (${uniqueKeys.length}); max ${IMPORT_MAX_SYMBOLS} per import.` }] };
  }
  for (const key of uniqueKeys) {
    const [symbol, exchange] = key.split("|");
    // Reject malformed tickers before they create junk reference rows / provider calls.
    if (!isValidSymbol(symbol) || !isValidExchange(exchange)) {
      errors.push({ line: 0, message: `Invalid symbol/exchange "${symbol}/${exchange}"` });
      continue;
    }
    let { data: inst } = await admin
      .from("instruments").select("id, currency").eq("symbol", symbol).eq("exchange", exchange).maybeSingle();
    if (!inst) {
      const meta = await searchInstrument(symbol, exchange);
      const { data: newInst } = await admin.from("instruments").insert({
        symbol, exchange, name: meta?.name ?? symbol,
        currency: meta?.currency ?? "USD", type: meta?.type ?? "stock",
      }).select("id, currency").single();
      inst = newInst;
    }
    if (inst) instByKey.set(key, inst);
  }

  const today = todayIso();
  const toInsert: {
    portfolio_id: string; instrument_id: string; type: string;
    quantity: number; price: number; fees: number; currency: string;
    executed_at: string; note: string | null; dedupe_key: string;
  }[] = [];

  for (const r of rows) {
    const inst = instByKey.get(`${r.symbol}|${r.exchange}`);
    if (!inst) {
      errors.push({ line: r.line, message: `Couldn't resolve ${r.symbol} (${r.exchange})` });
      continue;
    }
    const executed_at = r.executed_at || today;
    toInsert.push({
      portfolio_id: portfolio.id,
      instrument_id: inst.id,
      type: r.type,
      quantity: r.quantity,
      price: r.price,
      fees: r.fees,
      currency: r.currency || inst.currency || "USD",
      executed_at,
      note: r.note,
      dedupe_key: transactionDedupeKey({
        ref: r.ref, type: r.type, instrument_id: inst.id,
        executed_at, quantity: r.quantity, price: r.price, fees: r.fees,
      }),
    });
  }

  let imported = 0;
  if (toInsert.length) {
    const { data: inserted, error } = await supabase
      .from("transactions")
      .upsert(toInsert, { onConflict: "portfolio_id,dedupe_key", ignoreDuplicates: true })
      .select("id");
    if (error) {
      return {
        imported: 0, duplicates: 0, failed: rows.length, total: rows.length,
        errors: [...errors, { line: 0, message: error.message }],
      };
    }
    imported = inserted?.length ?? 0;
  }

  // Best-effort: pull a fresh price for each instrument just imported.
  await Promise.all(
    uniqueKeys.map(async (key) => {
      const inst = instByKey.get(key);
      if (!inst) return;
      const [symbol, exchange] = key.split("|");
      const q = await getQuote(symbol, exchange);
      if (q.price != null) {
        await admin.from("price_cache").upsert({
          instrument_id: inst.id, price: q.price, currency: inst.currency,
          change_pct: q.changePct, as_of: new Date().toISOString(),
        });
      }
      await syncInstrumentDividends(admin, inst.id, symbol, exchange, inst.currency);
      await syncInstrumentPriceHistory(admin, inst.id, symbol, exchange);
    })
  );

  revalidatePath("/dashboard");
  revalidatePath("/dashboard/performance");
  return {
    imported,
    duplicates: toInsert.length - imported,
    failed: errors.length,
    total: rows.length,
    errors,
  };
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
