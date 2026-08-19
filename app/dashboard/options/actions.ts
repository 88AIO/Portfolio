"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getQuote } from "@/lib/marketdata";
import { ensurePortfolio } from "../actions";

function todayIso(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

// Record a sold/closed/expired/assigned option leg. Premium is entered PER SHARE
// (how sellers think); the DB stores it per share and multiplies by 100×contracts in the views.
// An "assigned" action also writes the linked equity leg (put → buy shares at strike,
// call → sell shares at strike) so cost basis and holdings stay correct automatically.
export async function addOptionTransaction(formData: FormData) {
  const supabase = await createClient();
  const admin = createAdminClient();

  const symbol = String(formData.get("symbol") || "").trim().toUpperCase();
  const exchange = String(formData.get("exchange") || "US").trim().toUpperCase();
  const action = String(formData.get("action") || "sell_to_open");
  const option_type = String(formData.get("option_type") || "put") === "call" ? "call" : "put";
  const strike = Number(formData.get("strike") || 0);
  const expiration = String(formData.get("expiration") || "");
  const contracts = Math.max(1, Math.round(Number(formData.get("contracts") || 1)));
  const premium = Number(formData.get("premium") || 0);
  const fee = Number(formData.get("fee") || 0);
  const trade_date = String(formData.get("trade_date") || "") || todayIso();
  const note = String(formData.get("note") || "").trim() || null;
  const portfolioIdRaw = String(formData.get("portfolio_id") || "").trim();

  const validActions = ["sell_to_open", "buy_to_close", "expired", "assigned", "rolled"];
  if (!symbol || !strike || !expiration || !validActions.includes(action)) return;

  // Resolve the target portfolio (must belong to the signed-in user); default to the primary one.
  let portfolioId = "";
  if (portfolioIdRaw) {
    const { data: pf } = await supabase
      .from("portfolios").select("id").eq("id", portfolioIdRaw).maybeSingle();
    if (pf) portfolioId = pf.id as string;
  }
  if (!portfolioId) portfolioId = (await ensurePortfolio()).id;

  // Resolve/create the UNDERLYING instrument (shared reference table, service role).
  let { data: inst } = await admin
    .from("instruments").select("id, currency").eq("symbol", symbol).eq("exchange", exchange).maybeSingle();
  if (!inst) {
    const { data: created } = await admin.from("instruments").insert({
      symbol, exchange, name: symbol, currency: "USD", type: "stock",
    }).select("id, currency").single();
    inst = created;
  }
  if (!inst) return;
  const currency = inst.currency || "USD";

  // Assignment writes the equity leg it creates (idempotent via a stable dedupe_key).
  let linkedTxnId: string | null = null;
  if (action === "assigned") {
    const isPut = option_type === "put";
    const { data: tx } = await supabase.from("transactions").upsert(
      {
        portfolio_id: portfolioId,
        instrument_id: inst.id,
        type: isPut ? "buy" : "sell",
        quantity: contracts * 100,
        price: strike,
        fees: 0,
        currency,
        executed_at: trade_date,
        note: `Assigned ${option_type} $${strike} exp ${expiration}`,
        dedupe_key: `opt-assign:${portfolioId}:${symbol}:${option_type}:${strike}:${expiration}`,
      },
      { onConflict: "portfolio_id,dedupe_key", ignoreDuplicates: false }
    ).select("id").single();
    linkedTxnId = (tx as { id: string } | null)?.id ?? null;
  }

  await supabase.from("option_transactions").upsert(
    {
      portfolio_id: portfolioId,
      instrument_id: inst.id,
      action,
      option_type,
      strike,
      expiration,
      contracts,
      premium,
      fee,
      trade_date,
      currency,
      linked_txn_id: linkedTxnId,
      note,
      dedupe_key: `opt:${action}:${symbol}:${option_type}:${strike}:${expiration}:${trade_date}:${contracts}:${premium}`,
    },
    { onConflict: "portfolio_id,dedupe_key", ignoreDuplicates: true }
  );

  // Pull a fresh underlying price so collateral / RoC / moneyness compute immediately.
  const q = await getQuote(symbol, exchange);
  if (q.price != null) {
    await admin.from("price_cache").upsert({
      instrument_id: inst.id, price: q.price, change_pct: q.changePct, currency, as_of: new Date().toISOString(),
    });
  }

  revalidatePath("/dashboard/options");
  revalidatePath("/dashboard");
}
