"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { ensurePortfolio } from "../actions";

function todayIso(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

// Record a manual cash movement (deposit / withdrawal / interest / fee) against an account.
export async function addCashEntry(formData: FormData) {
  const supabase = await createClient();

  const portfolioIdRaw = String(formData.get("portfolio_id") || "").trim();
  const entry_date = String(formData.get("entry_date") || "") || todayIso();
  const description = String(formData.get("description") || "").trim() || null;
  const amount = Number(formData.get("amount") || 0);
  const currency = String(formData.get("currency") || "USD").trim().toUpperCase() || "USD";
  const direction = String(formData.get("direction") || "in");
  if (!amount) return;
  const signed = direction === "out" ? -Math.abs(amount) : Math.abs(amount);

  let portfolioId = "";
  if (portfolioIdRaw) {
    const { data: pf } = await supabase.from("portfolios").select("id").eq("id", portfolioIdRaw).maybeSingle();
    if (pf) portfolioId = pf.id as string;
  }
  if (!portfolioId) portfolioId = (await ensurePortfolio()).id;

  await supabase.from("cash_ledger").insert({
    portfolio_id: portfolioId, entry_date, description, amount: signed, currency, source: "manual",
  });
  revalidatePath("/dashboard/cash");
}

export async function deleteCashEntry(formData: FormData) {
  const supabase = await createClient();
  const id = String(formData.get("id") || "");
  if (id) await supabase.from("cash_ledger").delete().eq("id", id);
  revalidatePath("/dashboard/cash");
}
