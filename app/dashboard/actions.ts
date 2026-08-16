"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getQuote, searchInstrument, getDividendInfo } from "@/lib/marketdata";
import { parseTransactionsCsv, transactionDedupeKey } from "@/lib/import/csv";
import type { ImportResult } from "@/lib/import/types";

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

  // Fetch a fresh price + dividend estimate for this instrument right away.
  const [q, div] = await Promise.all([getQuote(symbol, exchange), getDividendInfo(symbol, exchange)]);
  if (q.price != null) {
    await admin.from("price_cache").upsert({
      instrument_id: inst.id, price: q.price, currency: inst.currency,
      change_pct: q.changePct, as_of: new Date().toISOString(),
    });
  }
  if (div) {
    await admin.from("instruments").update({
      annual_div_per_share: div.annualDividendPerShare,
      div_yield_ttm: div.yieldTtm,
      ex_dividend_date: div.exDividendDate,
      next_dividend_date: div.nextDividendDate,
    }).eq("id", inst.id);
  }

  revalidatePath("/dashboard");
}

// Refresh live prices for every instrument the user holds.
export async function refreshPrices() {
  const supabase = await createClient();
  const admin = createAdminClient();
  const { data: pos } = await supabase.from("positions").select("instrument_id, symbol, exchange");
  if (!pos) return;
  await Promise.all(
    pos.map(async (p) => {
      const [q, div] = await Promise.all([
        getQuote(p.symbol, p.exchange),
        getDividendInfo(p.symbol, p.exchange),
      ]);
      if (q.price != null) {
        await admin.from("price_cache").upsert({
          instrument_id: p.instrument_id, price: q.price,
          change_pct: q.changePct, as_of: new Date().toISOString(),
        });
      }
      if (div) {
        await admin.from("instruments").update({
          annual_div_per_share: div.annualDividendPerShare,
          div_yield_ttm: div.yieldTtm,
          ex_dividend_date: div.exDividendDate,
          next_dividend_date: div.nextDividendDate,
        }).eq("id", p.instrument_id);
      }
    })
  );
  revalidatePath("/dashboard");
}

// Import buy/sell/dividend transactions from a CSV file. Idempotent: re-importing the
// same rows is a no-op (dedupe on broker ref when present, else a natural key of the trade).
export async function importTransactions(formData: FormData): Promise<ImportResult> {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { imported: 0, duplicates: 0, failed: 0, total: 0, errors: [{ line: 0, message: "No file provided." }] };
  }

  const { rows, errors } = parseTransactionsCsv(await file.text());
  if (rows.length === 0) {
    return { imported: 0, duplicates: 0, failed: errors.length, total: 0, errors };
  }

  const supabase = await createClient();
  const admin = createAdminClient();
  const portfolio = await ensurePortfolio();

  // Resolve each unique (symbol, exchange) to an instrument once (creating new ones).
  const instByKey = new Map<string, { id: string; currency: string }>();
  const uniqueKeys = [...new Set(rows.map((r) => `${r.symbol}|${r.exchange}`))];
  for (const key of uniqueKeys) {
    const [symbol, exchange] = key.split("|");
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
      const [q, div] = await Promise.all([getQuote(symbol, exchange), getDividendInfo(symbol, exchange)]);
      if (q.price != null) {
        await admin.from("price_cache").upsert({
          instrument_id: inst.id, price: q.price, currency: inst.currency,
          change_pct: q.changePct, as_of: new Date().toISOString(),
        });
      }
      if (div) {
        await admin.from("instruments").update({
          annual_div_per_share: div.annualDividendPerShare,
          div_yield_ttm: div.yieldTtm,
          ex_dividend_date: div.exDividendDate,
          next_dividend_date: div.nextDividendDate,
        }).eq("id", inst.id);
      }
    })
  );

  revalidatePath("/dashboard");
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
