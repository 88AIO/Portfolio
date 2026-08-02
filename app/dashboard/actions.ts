"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getQuote, searchInstrument } from "@/lib/marketdata";

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

  await supabase.from("transactions").insert({
    portfolio_id: portfolio.id, instrument_id: inst.id,
    type, quantity, price, currency: inst.currency, executed_at,
  });

  // Fetch a fresh price for this instrument right away
  const q = await getQuote(symbol, exchange);
  if (q.price != null) {
    await admin.from("price_cache").upsert({
      instrument_id: inst.id, price: q.price, currency: inst.currency,
      change_pct: q.changePct, as_of: new Date().toISOString(),
    });
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
      const q = await getQuote(p.symbol, p.exchange);
      if (q.price != null) {
        await admin.from("price_cache").upsert({
          instrument_id: p.instrument_id, price: q.price,
          change_pct: q.changePct, as_of: new Date().toISOString(),
        });
      }
    })
  );
  revalidatePath("/dashboard");
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
