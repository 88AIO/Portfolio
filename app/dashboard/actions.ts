"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/supabase/user";
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
import { isValidYmd, todayIso } from "@/lib/date";

// Get the user's default portfolio, creating one on first use.
export async function ensurePortfolio() {
  const supabase = await createClient();
  // Request-cached: the calling page has almost always resolved the user already, so this is free.
  const user = await getCurrentUser();
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
  // Only meaningful on a buy: the dividend row is the payout, not the purchase it funded.
  const drip = type === "buy" && formData.get("drip") != null;
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
      quantity, price, fees: 0, currency: inst.currency, executed_at: date, dedupe_key, drip,
    },
    { onConflict: "portfolio_id,dedupe_key", ignoreDuplicates: true }
  );

  // Fetch a fresh price + full dividend sync for this instrument right away.
  const q = await getQuote(symbol, exchange, inst.currency);
  if (q.price != null) {
    await admin.from("price_cache").upsert({
      instrument_id: inst.id, price: q.price, currency: inst.currency,
      change_pct: q.changePct, as_of: new Date().toISOString(),
    });
  }
  await syncInstrumentDividends(admin, inst.id, symbol, exchange, inst.currency);
  await syncInstrumentPriceHistory(admin, inst.id, symbol, exchange, undefined, inst.currency);

  revalidatePath("/dashboard");
  revalidatePath("/dashboard/performance");
}

// Refresh live prices for every instrument the user holds.
export async function refreshPrices() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login"); // don't let anon calls drive provider fan-out

  const admin = createAdminClient();
  const { data: allPos } = await supabase
    .from("positions").select("instrument_id, symbol, exchange, name, currency, sector, sector_weights, type, price_as_of");
  if (!allPos) return;

  // Freshness gate: skip instruments quoted within the last ~2 minutes. price_cache is shared
  // across users, so this doubles as a global cooldown — however many users (or repeat clicks)
  // hammer the button, each instrument costs at most one provider call per window. Without it, one
  // enthusiastic user could rate-limit the free Yahoo feed every other user depends on.
  const FRESH_MS = 2 * 60_000;
  const pos = allPos.filter(
    (p: { price_as_of: string | null }) =>
      !p.price_as_of || Date.now() - new Date(p.price_as_of).getTime() > FRESH_MS
  );

  // "Refresh prices" is the FAST path — it only fetches live quotes (price + day change), one call
  // per holding, so it always finishes well inside the function limit even for large portfolios.
  // The heavier provider work (dividends, price history, sector/name enrichment) runs from the
  // nightly cron at /api/cron/sync, matching the project brief: the app reads cached tables and
  // only the scheduled sync fans out to the provider. New manual adds still sync their own
  // fundamentals immediately in addTransaction.
  for (let i = 0; i < pos.length; i += 10) {
    await Promise.all(
      pos.slice(i, i + 10).map(async (p) => {
        const q = await getQuote(p.symbol, p.exchange, p.currency);
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

  // Resolve each unique (symbol, exchange) to an instrument once (creating new ones). Track which
  // instruments this import actually CREATED — the post-import provider fan-out is scoped to those,
  // so re-importing the same file (a DB no-op via dedupe) costs zero provider calls.
  const instByKey = new Map<string, { id: string; currency: string }>();
  const createdKeys: string[] = [];
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
      if (inst) createdKeys.push(key);
    }
    if (inst) instByKey.set(key, inst);
  }

  const today = todayIso();
  const toInsert: {
    portfolio_id: string; instrument_id: string; type: string;
    quantity: number; price: number; fees: number; currency: string;
    executed_at: string; note: string | null; dedupe_key: string; drip: boolean;
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
      drip: r.drip,
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

  // Best-effort: quote each instrument this import CREATED, in bounded batches. Previously this
  // fanned out quotes + dividends + price history for EVERY symbol in the file — up to ~2,000
  // provider calls per click, re-fired in full on every re-import, and killed mid-flight by the
  // 60s page limit. Created-only + quotes-only bounds the burst; the nightly cron picks up
  // dividends/history for the new names (the app's read-from-cache architecture already assumes
  // reference data arrives on the nightly cadence).
  const BATCH = 6;
  for (let i = 0; i < createdKeys.length; i += BATCH) {
    await Promise.all(
      createdKeys.slice(i, i + BATCH).map(async (key) => {
        const inst = instByKey.get(key);
        if (!inst) return;
        const [symbol, exchange] = key.split("|");
        const q = await getQuote(symbol, exchange, inst.currency);
        if (q.price != null) {
          await admin.from("price_cache").upsert({
            instrument_id: inst.id, price: q.price, currency: inst.currency,
            change_pct: q.changePct, as_of: new Date().toISOString(),
          });
        }
      })
    );
  }

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

/**
 * Remove a holding outright: every share transaction, dividend and option leg on one instrument.
 *
 * Deleting a position row by row through the activity list is fine for correcting one mistyped
 * trade, but it is the wrong tool for "I added this to try it out and want it gone" — which is how
 * most first positions end. Both deletes are RLS-scoped, so they can only ever touch rows in a
 * portfolio the signed-in user owns; the instrument row itself is shared reference data and stays.
 */
export async function deleteHolding(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const instrumentId = String(formData.get("instrument_id") || "");
  if (!instrumentId) return;

  const [tx, opt] = await Promise.all([
    supabase.from("transactions").delete().eq("instrument_id", instrumentId),
    supabase.from("option_transactions").delete().eq("instrument_id", instrumentId),
  ]);
  // Surface a failure instead of bouncing the user to a dashboard that still shows the holding.
  if (tx.error || opt.error) {
    throw new Error("We couldn't remove that holding just now. Please try again.");
  }

  revalidatePath("/dashboard");
  revalidatePath("/dashboard/performance");
  revalidatePath("/dashboard/options");
  revalidatePath("/dashboard/dividends");
  redirect("/dashboard");
}

export async function signOut() {
  const supabase = await createClient();
  // "local" clears this device's session and cookies without waiting on a round trip to revoke the
  // refresh token server-side. The user is signed out here the moment the cookies are gone, and
  // the token expires on its own; waiting for the network just made the button feel sticky.
  await supabase.auth.signOut({ scope: "local" });
  redirect("/login");
}

// If this delete emptied the holding, its detail page would 404 — send the user to the overview
// instead. Counts are RLS-scoped, so they only see the caller's own remaining rows on this symbol.
async function revalidateAfterActivityDelete(
  supabase: Awaited<ReturnType<typeof createClient>>,
  instrumentId: string,
) {
  revalidatePath("/dashboard");
  revalidatePath("/dashboard/performance");
  revalidatePath("/dashboard/options");
  if (!instrumentId) return;
  const [{ count: txLeft }, { count: optLeft }] = await Promise.all([
    supabase.from("transactions").select("id", { count: "exact", head: true }).eq("instrument_id", instrumentId),
    supabase.from("option_transactions").select("id", { count: "exact", head: true }).eq("instrument_id", instrumentId),
  ]);
  if ((txLeft ?? 0) + (optLeft ?? 0) === 0) redirect("/dashboard");
  revalidatePath(`/dashboard/holding/${instrumentId}`);
}

// Delete one of the caller's own transactions. RLS scopes the delete to rows in the user's
// portfolios, so an id they don't own simply affects nothing.
export async function deleteTransaction(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const id = String(formData.get("id") || "");
  const instrumentId = String(formData.get("instrument_id") || "");
  if (!id) return;
  await supabase.from("transactions").delete().eq("id", id);
  await revalidateAfterActivityDelete(supabase, instrumentId);
}

// Delete one of the caller's own option legs (same RLS scoping as above).
export async function deleteOptionLeg(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const id = String(formData.get("id") || "");
  const instrumentId = String(formData.get("instrument_id") || "");
  if (!id) return;
  await supabase.from("option_transactions").delete().eq("id", id);
  await revalidateAfterActivityDelete(supabase, instrumentId);
}


// Mark an existing purchase as a reinvested dividend, or unmark it.
//
// The add form covers what you record from now on; this covers the ledger you already imported,
// which is where the need actually is — a broker export that dropped its description column leaves
// every past reinvestment indistinguishable from an ordinary buy.
export async function toggleDrip(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const id = String(formData.get("id") || "");
  const instrumentId = String(formData.get("instrument_id") || "");
  const next = formData.get("next") === "1";
  if (!id) return;

  // RLS scopes this to the user's own transactions, and the type guard keeps the flag off rows
  // where it would be meaningless — a dividend tagged DRIP would double the reinvested share
  // count anyone reads off the page.
  const { error } = await supabase
    .from("transactions")
    .update({ drip: next })
    .eq("id", id)
    .eq("type", "buy");
  if (error) throw new Error("We couldn't update that transaction just now. Please try again.");

  if (instrumentId) revalidatePath(`/dashboard/holding/${instrumentId}`);
  revalidatePath("/dashboard");
}
