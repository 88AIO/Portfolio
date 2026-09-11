"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { ensurePortfolio } from "../actions";
import { isValidYmd, todayIso } from "@/lib/date";
import { ok, fail, type ActionResult } from "@/lib/actionResult";

// Record a manual cash movement (deposit / withdrawal / interest / fee) against an account.
export async function addCashEntry(formData: FormData): Promise<ActionResult> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return fail("You're signed out. Sign in and try again."); // RLS also scopes every write below

  const portfolioIdRaw = String(formData.get("portfolio_id") || "").trim();
  const entry_date = String(formData.get("entry_date") || "") || todayIso();
  const description = String(formData.get("description") || "").trim().slice(0, 200) || null;
  const amount = Number(formData.get("amount") || 0);
  const currency = String(formData.get("currency") || "USD").trim().toUpperCase() || "USD";
  const direction = String(formData.get("direction") || "in");
  // Return the message (never throw): the form shows it, and a bad entry never looks saved.
  if (!amount || !Number.isFinite(amount)) return fail("Enter an amount greater than zero.");
  if (!isValidYmd(entry_date)) return fail("That date isn't a valid date.");
  if (!/^[A-Z]{3}$/.test(currency)) return fail("Currency should be a 3-letter code, like USD or SGD.");
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
  if (error) return fail("Couldn't save that entry. Please try again.");
  revalidatePath("/dashboard/cash");
  return ok;
}

export async function deleteCashEntry(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return; // defense-in-depth; RLS also limits the delete to the owner's own rows
  const id = String(formData.get("id") || "");
  if (id) {
    const { error } = await supabase.from("cash_ledger").delete().eq("id", id);
    if (error) throw new Error("We couldn't remove that entry just now. Please try again.");
  }
  revalidatePath("/dashboard/cash");
}
