"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getQuote, searchInstrument } from "@/lib/marketdata";
import { syncInstrumentDividends, syncInstrumentPriceHistory } from "@/lib/marketdata/sync";
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
import { isValidYmd } from "@/lib/date";

// Local date as YYYY-MM-DD — used for explicit executed_at and stable dedupe keys.
function todayIso(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

// Get the user's default portfolio, creating one on first use.
export async function ensurePortfolio() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: existing } = await supabase
    .from("portfolios").select("*").eq("user_id", user.id).order("created_at").limit(1);
  if (existing && existing.length) return existing[0];

  const { data: created, error } = await supabase
    .from("portfolios").insert({ user_id: user.id, name: "My Portfolio" }).select().single();
  // A transient insert failure must not return undefined — callers immediately read .id /
  // .base_currency. Throw so the error boundary shows a calm retry instead of a null-deref crash.
  if (error || !created) throw new Error("We couldn't set up your portfolio just now. Please try again.");
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
  // Throw (don't silently return) on bad input so the form's catch shows an error instead of
  // resetting to a false "success" — the user must know nothing was added.
  if (!symbol || quantity <= 0) throw new Error("Enter a symbol and a quantity greater than zero.");
  // Reject malformed tickers before they create junk reference rows / provider calls.
  if (!isValidSymbol(symbol) || !isValidExchange(exchange)) throw new Error("That symbol or exchange doesn't look right.");
  // A supplied date must be a real calendar date (empty is fine — we default to today).
  if (executed_at && !isValidYmd(executed_at)) throw new Error("That trade date isn't a valid date.");

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
  if (!inst) throw new Error("Couldn't look up that symbol. Check it and try again.");

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

  // "Refresh prices" is the FAST path — it only fetches live quotes (price + day change), one call
  // per holding, so it always finishes well inside the function limit even for large portfolios.
  // The heavier provider work (dividends, price history, sector/name enrichment) runs from the
  // nightly cron at /api/cron/sync, matching the project brief: the app reads cached tables and
  // only the scheduled sync fans out to the provider. New manual adds still sync their own
  // fundamentals immediately in addTransaction.
  for (let i = 0; i < pos.length; i += 10) {
    await Promise.all(
      pos.slice(i, i + 10).map(async (p) => {
        const q = await getQuote(p.symbol, p.exchange);
        if (q.price != null) {
          await admin.from("price_cache").upsert({
            instrument_id: p.instrument_id, price: q.price,
            change_pct: q.changePct, currency: q.currency ?? p.currency ?? null,
            as_of: new Date().toISOString(),
          });
        }
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

  // Two genuinely-identical fills with no broker ref (same symbol/qty/price/day/fees) share one
  // natural dedupe key and would collapse into a single row, under-counting shares. Disambiguate
  // repeats WITHIN this file with an occurrence suffix so distinct fills survive. Re-importing the
  // same file reproduces the same sequence of keys, so idempotency holds (no duplicate rows).
  const natSeen = new Map<string, number>();
  for (const r of rows) {
    const inst = instByKey.get(`${r.symbol}|${r.exchange}`);
    if (!inst) {
      errors.push({ line: r.line, message: `Couldn't resolve ${r.symbol} (${r.exchange})` });
      continue;
    }
    const executed_at = r.executed_at || today;
    let dedupe_key = transactionDedupeKey({
      ref: r.ref, type: r.type, instrument_id: inst.id,
      executed_at, quantity: r.quantity, price: r.price, fees: r.fees,
    });
    if (dedupe_key.startsWith("nat:")) {
      const n = natSeen.get(dedupe_key) ?? 0;
      natSeen.set(dedupe_key, n + 1);
      if (n > 0) dedupe_key = `${dedupe_key}#${n}`; // 2nd+ identical no-ref fill in this file
    }
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
      dedupe_key,
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
