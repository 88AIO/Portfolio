"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getQuote } from "@/lib/marketdata";
import { getCachedRates } from "@/lib/fx";
import { ensurePortfolio } from "../actions";
import { isValidYmd, todayIso } from "@/lib/date";
import { computeOption, legPremium, type OptionPositionRow } from "@/lib/options";
import { digestEmailHtml, type DigestData, type PositionLite } from "@/lib/notifications/build";
import { sendEmail, emailShell } from "@/lib/email";
import { isValidSymbol, isValidExchange } from "@/lib/import/csv";

// --- Notification preferences (options/dividend alerts + weekly income digest) ---
export async function getNotificationPrefs(): Promise<{ email_alerts: boolean; email_digest: boolean }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { email_alerts: false, email_digest: false };
  const { data } = await supabase
    .from("notification_prefs").select("email_alerts, email_digest").eq("user_id", user.id).maybeSingle();
  return { email_alerts: !!data?.email_alerts, email_digest: !!data?.email_digest };
}


// Send a test copy of the weekly income digest to the signed-in user's own email — built from their
// real last-7-days data — so they can confirm delivery and see exactly what the digest looks like.
export async function sendTestEmail(): Promise<{ ok: boolean; message: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.email) return { ok: false, message: "No email address is on your account." };
  const portfolio = await ensurePortfolio();
  const base = portfolio.base_currency || "USD";

  const today = todayIso();
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
  const in7 = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);

  const [{ data: posData }, { data: optPos }, { data: optTx }, { data: divTx }] = await Promise.all([
    supabase.from("positions").select("symbol, currency, shares, next_dividend_date, next_dividend_per_share, annual_div_per_share, div_frequency"),
    supabase.from("option_positions").select("*"),
    supabase.from("option_transactions").select("action, premium, contracts, fee, currency, trade_date").gte("trade_date", weekAgo),
    supabase.from("transactions").select("quantity, price, currency, executed_at").eq("type", "dividend").gte("executed_at", weekAgo),
  ]);

  const positions = (posData ?? []) as PositionLite[];
  const options = ((optPos ?? []) as OptionPositionRow[]).map(computeOption);
  const oTx = (optTx ?? []) as { action: string; premium: number; contracts: number; fee: number | null; currency: string }[];
  const dTx = (divTx ?? []) as { quantity: number; price: number; currency: string }[];

  const rates = await getCachedRates(supabase, [...oTx.map((o) => o.currency), ...dTx.map((d) => d.currency), ...positions.map((p) => p.currency)], base);
  const fx = (c: string) => rates[c] ?? 1;

  const premiumWeek = oTx.reduce((s, o) => s + legPremium(o) * fx(o.currency), 0);
  const dividendsWeek = dTx.reduce((s, d) => s + d.quantity * d.price * fx(d.currency), 0);
  const upcomingExDiv = positions
    .filter((p) => p.shares > 0 && p.next_dividend_date && p.next_dividend_date >= today && p.next_dividend_date <= in7)
    .map((p) => ({
      symbol: p.symbol,
      date: p.next_dividend_date as string,
      est: p.next_dividend_per_share != null
        ? p.next_dividend_per_share * p.shares
        : (p.annual_div_per_share && p.div_frequency ? (p.annual_div_per_share / p.div_frequency) * p.shares : null),
      currency: p.currency,
    }));
  const expiringOptions = options
    .filter((o) => o.isOpen && o.dte >= 0 && o.dte <= 7)
    .map((o) => ({ symbol: o.symbol, text: `${o.symbol} ${o.option_type} — ${o.dte}d left${o.status === "may_be_assigned" ? " (in the money)" : ""}` }));

  const digest: DigestData = { premiumWeek, dividendsWeek, totalWeek: premiumWeek + dividendsWeek, upcomingExDiv, expiringOptions, base };
  const intro = `<p style="margin:0 0 14px;color:#475569;font-size:14px">This is a <strong>test</strong> — your real weekly digest looks just like this. If it reached your inbox, email notifications are working.</p>`;
  const res = await sendEmail(user.email, "Snowfolio — test email", emailShell("Test email", intro + digestEmailHtml(digest)));

  if (res.sent) return { ok: true, message: `Sent to ${user.email}. Check your inbox (and spam folder).` };
  if (res.skipped) return { ok: false, message: `Email isn't enabled on this instance yet (${res.skipped}). A RESEND_API_KEY needs to be set.` };
  return { ok: false, message: `Couldn't send: ${res.error ?? "unknown error"}.` };
}

export async function updateNotificationPrefs(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;
  const email_alerts = formData.get("email_alerts") === "on";
  const email_digest = formData.get("email_digest") === "on";
  await supabase.from("notification_prefs").upsert(
    { user_id: user.id, email_alerts, email_digest, updated_at: new Date().toISOString() },
    { onConflict: "user_id" }
  );
  revalidatePath("/dashboard/options");
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
  // Throw (don't silently return) on bad input so AddOptionForm's catch shows an error instead of
  // resetting to a false success — a mistyped leg must never look saved (same contract as
  // addTransaction). The income totals would otherwise silently understate.
  if (!symbol || !strike || !expiration || !validActions.includes(action))
    throw new Error("Enter a symbol, a strike, and an expiration.");
  // Dates hit NOT NULL columns — reject a malformed expiration/trade_date cleanly instead of 500ing.
  if (!isValidYmd(expiration) || !isValidYmd(trade_date))
    throw new Error("That expiration or trade date isn't a valid date.");
  // Validate the ticker/exchange before any service-role write into the shared `instruments` table,
  // so a malformed underlying can't create junk reference rows (matches addTransaction / CSV import).
  if (!isValidSymbol(symbol) || !isValidExchange(exchange))
    throw new Error("That symbol or exchange doesn't look right.");

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
  if (!inst) throw new Error("Couldn't look up that symbol. Check it and try again.");
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

  const { error: upsertError } = await supabase.from("option_transactions").upsert(
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
  if (upsertError) throw new Error("Couldn't save that option leg. Please try again.");

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
