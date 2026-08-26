"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { ensurePortfolio } from "../actions";
import { isValidYmd, todayIso } from "@/lib/date";

// Record a manual cash movement (deposit / withdrawal / interest / fee) against an account.
export async function addCashEntry(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return; // defense-in-depth; RLS also scopes every write below to the owner

  const portfolioIdRaw = String(formData.get("portfolio_id") || "").trim();
  const entry_date = String(formData.get("entry_date") || "") || todayIso();
  const description = String(formData.get("description") || "").trim() || null;
  const amount = Number(formData.get("amount") || 0);
  const currency = String(formData.get("currency") || "USD").trim().toUpperCase() || "USD";
  const direction = String(formData.get("direction") || "in");
  // Throw (don't silently return) on bad input so the form shows an error instead of resetting
  // to a false success — same contract as addTransaction.
  if (!amount || !Number.isFinite(amount)) throw new Error("Enter an amount greater than zero.");
  if (!isValidYmd(entry_date)) throw new Error("That date isn't a valid date.");
  const signed = direction === "out" ? -Math.abs(amount) : Math.abs(amount);

  let portfolioId = "";
  if (portfolioIdRaw) {
    const { data: pf } = await supabase.from("portfolios").select("id").eq("id", portfolioIdRaw).maybeSingle();
    if (pf) portfolioId = pf.id as string;
  }
  if (!portfolioId) portfolioId = (await ensurePortfolio()).id;

  const { error } = await supabase.from("cash_ledger").insert({
    portfolio_id: portfolioId, entry_date, description, amount: signed, currency, source: "manual",
  });
  if (error) throw new Error("Couldn't save that entry. Please try again.");
  revalidatePath("/dashboard/cash");
}

export async function deleteCashEntry(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return; // defense-in-depth; RLS also limits the delete to the owner's own rows
  const id = String(formData.get("id") || "");
  if (id) await supabase.from("cash_ledger").delete().eq("id", id);
  revalidatePath("/dashboard/cash");
}
