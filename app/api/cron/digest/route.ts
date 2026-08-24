import { createAdminClient } from "@/lib/supabase/admin";
import { getCachedRates } from "@/lib/fx";
import { computeOption, type OptionPositionRow } from "@/lib/options";
import { digestEmailHtml, type DigestData, type PositionLite } from "@/lib/notifications/build";
import { sendEmail, emailShell } from "@/lib/email";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Weekly income digest. For each opted-in user: premium + dividends collected in the last 7 days,
// upcoming ex-dividends, and options expiring this week — one email. CRON_SECRET-guarded.

type OptTx = { portfolio_id: string; action: string; premium: number; contracts: number; fee: number; currency: string; trade_date: string };
type DivTx = { portfolio_id: string; quantity: number; price: number; currency: string; executed_at: string };

function legPremium(o: OptTx): number {
  const gross = (o.premium ?? 0) * (o.contracts ?? 0) * 100;
  const fee = o.fee ?? 0;
  if (o.action === "sell_to_open") return gross - fee;
  if (o.action === "buy_to_close" || o.action === "rolled") return -gross - fee;
  return -fee;
}

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  return !!secret && request.headers.get("authorization") === `Bearer ${secret}`;
}

function push<T>(m: Map<string, T[]>, k: string, v: T) {
  const arr = m.get(k);
  if (arr) arr.push(v);
  else m.set(k, [v]);
}

export async function GET(request: Request) {
  if (!authorized(request)) return new Response("Unauthorized", { status: 401 });
  const admin = createAdminClient();
  const today = new Date().toISOString().slice(0, 10);
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
  const in7 = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);

  const [{ data: prefs }, { data: portfolios }, { data: posData }, { data: optPosData }, { data: optTxData }, { data: divTxData }] =
    await Promise.all([
      admin.from("notification_prefs").select("user_id").eq("email_digest", true),
      admin.from("portfolios").select("id, user_id, base_currency"),
      admin.from("positions").select("portfolio_id, symbol, currency, shares, next_dividend_date, next_dividend_per_share, annual_div_per_share, div_frequency"),
      admin.from("option_positions").select("*"),
      admin.from("option_transactions").select("portfolio_id, action, premium, contracts, fee, currency, trade_date").gte("trade_date", weekAgo),
      admin.from("transactions").select("portfolio_id, quantity, price, currency, executed_at").eq("type", "dividend").gte("executed_at", weekAgo),
    ]);

  const userByPortfolio = new Map<string, string>();
  const baseByUser = new Map<string, string>();
  for (const p of (portfolios ?? []) as { id: string; user_id: string; base_currency: string | null }[]) {
    userByPortfolio.set(p.id, p.user_id);
    if (!baseByUser.has(p.user_id)) baseByUser.set(p.user_id, p.base_currency || "USD");
  }
  const enabled = new Set((prefs ?? []).map((r: { user_id: string }) => r.user_id));

  const posByUser = new Map<string, PositionLite[]>();
  for (const p of (posData ?? []) as (PositionLite & { portfolio_id: string })[]) {
    const uid = userByPortfolio.get(p.portfolio_id); if (uid && enabled.has(uid)) push(posByUser, uid, p);
  }
  const optPosByUser = new Map<string, OptionPositionRow[]>();
  for (const o of (optPosData ?? []) as (OptionPositionRow & { portfolio_id: string })[]) {
    const uid = userByPortfolio.get(o.portfolio_id); if (uid && enabled.has(uid)) push(optPosByUser, uid, o);
  }
  const optTxByUser = new Map<string, OptTx[]>();
  for (const o of (optTxData ?? []) as OptTx[]) {
    const uid = userByPortfolio.get(o.portfolio_id); if (uid && enabled.has(uid)) push(optTxByUser, uid, o);
  }
  const divTxByUser = new Map<string, DivTx[]>();
  for (const d of (divTxData ?? []) as DivTx[]) {
    const uid = userByPortfolio.get(d.portfolio_id); if (uid && enabled.has(uid)) push(divTxByUser, uid, d);
  }

  let emailed = 0;
  for (const uid of enabled) {
    const base = baseByUser.get(uid) || "USD";
    const optTx = optTxByUser.get(uid) ?? [];
    const divTx = divTxByUser.get(uid) ?? [];
    const positions = posByUser.get(uid) ?? [];
    const options = (optPosByUser.get(uid) ?? []).map(computeOption);

    const currencies = [...optTx.map((o) => o.currency), ...divTx.map((d) => d.currency), ...positions.map((p) => p.currency)];
    const rates = await getCachedRates(admin, currencies, base);
    const fx = (c: string) => rates[c] ?? 1;

    const premiumWeek = optTx.reduce((s, o) => s + legPremium(o) * fx(o.currency), 0);
    const dividendsWeek = divTx.reduce((s, d) => s + d.quantity * d.price * fx(d.currency), 0);

    const upcomingExDiv = positions
      .filter((p) => p.shares > 0 && p.next_dividend_date && p.next_dividend_date >= today && p.next_dividend_date <= in7)
      .map((p) => ({
        symbol: p.symbol,
        date: p.next_dividend_date as string,
        est: p.next_dividend_per_share != null ? p.next_dividend_per_share * p.shares : (p.annual_div_per_share && p.div_frequency ? (p.annual_div_per_share / p.div_frequency) * p.shares : null),
        currency: p.currency,
      }));
    const expiringOptions = options
      .filter((o) => o.isOpen && o.dte >= 0 && o.dte <= 7)
      .map((o) => ({ symbol: o.symbol, text: `${o.symbol} ${o.option_type} — ${o.dte}d left${o.status === "may_be_assigned" ? " (in the money)" : ""}` }));

    // Nothing happened and nothing's coming up → don't send an empty digest.
    if (premiumWeek === 0 && dividendsWeek === 0 && upcomingExDiv.length === 0 && expiringOptions.length === 0) continue;

    const digest: DigestData = { premiumWeek, dividendsWeek, totalWeek: premiumWeek + dividendsWeek, upcomingExDiv, expiringOptions, base };
    const { data: userRes } = await admin.auth.admin.getUserById(uid);
    const email = userRes.user?.email;
    if (!email) continue;

    const res = await sendEmail(email, "Your weekly income — Snowfolio", emailShell("This week's income", digestEmailHtml(digest)));
    if (res.sent) emailed++;
  }

  return Response.json({ emailed, users: enabled.size });
}
