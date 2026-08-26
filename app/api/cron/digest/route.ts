import { createAdminClient } from "@/lib/supabase/admin";
import { getCachedRates } from "@/lib/fx";
import { computeOption, legPremium, type OptionPositionRow } from "@/lib/options";
import { digestEmailHtml, type DigestData, type PositionLite } from "@/lib/notifications/build";
import { sendEmail, emailShell } from "@/lib/email";
import { fetchAll } from "@/lib/supabase/paginate";
import { recordSyncRun, listAllUserEmails } from "@/lib/cron";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Weekly income digest. For each opted-in user: premium + dividends collected in the last 7 days,
// upcoming ex-dividends, and options expiring this week — one email. CRON_SECRET-guarded.

type OptTx = { portfolio_id: string; action: string; premium: number; contracts: number; fee: number; currency: string; trade_date: string };
type DivTx = { portfolio_id: string; quantity: number; price: number; currency: string; executed_at: string };

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
  const startedAt = Date.now();
  const admin = createAdminClient();
  const today = new Date().toISOString().slice(0, 10);
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
  const in7 = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);

  // These reads span EVERY user (service role bypasses RLS), so any of them can exceed the
  // ~1000-row cap. Page through each with a unique sort key, or a truncated read would silently
  // understate some users' weekly totals or drop their upcoming-events rows.
  const [prefs, portfolios, posData, optPosData, optTxData, divTxData] =
    await Promise.all([
      fetchAll<{ user_id: string }>((f, t) =>
        admin.from("notification_prefs").select("user_id").eq("email_digest", true).order("user_id").range(f, t)),
      fetchAll<{ id: string; user_id: string; base_currency: string | null }>((f, t) =>
        admin.from("portfolios").select("id, user_id, base_currency").order("id").range(f, t)),
      fetchAll<PositionLite & { portfolio_id: string }>((f, t) =>
        admin.from("positions").select("portfolio_id, symbol, currency, shares, next_dividend_date, next_dividend_per_share, annual_div_per_share, div_frequency").order("portfolio_id").order("instrument_id").range(f, t)),
      fetchAll<OptionPositionRow & { portfolio_id: string }>((f, t) =>
        admin.from("option_positions").select("*").order("portfolio_id").order("instrument_id").order("option_type").order("strike").order("expiration").range(f, t)),
      fetchAll<OptTx>((f, t) =>
        admin.from("option_transactions").select("portfolio_id, action, premium, contracts, fee, currency, trade_date").gte("trade_date", weekAgo).order("portfolio_id").order("trade_date").order("id").range(f, t)),
      fetchAll<DivTx>((f, t) =>
        admin.from("transactions").select("portfolio_id, quantity, price, currency, executed_at").eq("type", "dividend").gte("executed_at", weekAgo).order("portfolio_id").order("executed_at").order("id").range(f, t)),
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
  // Hoisted out of the per-user loop: one email map (paginated — a bare getUserById-per-user or
  // unpaginated listUsers silently breaks past ~50 users) and one FX read per base currency
  // (fx_rates is a global table; re-reading it per user was N identical round trips).
  const emailById = await listAllUserEmails(admin);
  const allCurrencies = [
    ...optTxData.map((o) => o.currency),
    ...divTxData.map((d) => d.currency),
    ...posData.map((p) => p.currency),
  ];
  const ratesByBase = new Map<string, Record<string, number>>();
  for (const b of new Set(baseByUser.values())) {
    ratesByBase.set(b, await getCachedRates(admin, allCurrencies, b));
  }

  // One digest per user per ISO week: a manual re-fire or platform retry must not double-send.
  // Uses the same sent_notifications dedupe log the alerts cron writes.
  const weekKey = `digest:${today.slice(0, 4)}-W${Math.ceil(
    ((Date.parse(today) - Date.parse(`${today.slice(0, 4)}-01-01`)) / 86400000 + 1) / 7,
  )}`;

  for (const uid of enabled) {
    const base = baseByUser.get(uid) || "USD";
    const optTx = optTxByUser.get(uid) ?? [];
    const divTx = divTxByUser.get(uid) ?? [];
    const positions = posByUser.get(uid) ?? [];
    const options = (optPosByUser.get(uid) ?? []).map(computeOption);

    const rates = ratesByBase.get(base) ?? {};
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
    const email = emailById.get(uid);
    if (!email) continue;

    // Skip anyone already sent this week's digest (re-fire / retry safety).
    const { data: already } = await admin
      .from("sent_notifications").select("dedupe_key").eq("user_id", uid).eq("dedupe_key", weekKey).maybeSingle();
    if (already) continue;

    const res = await sendEmail(email, "Your weekly income — Snowfolio", emailShell("This week's income", digestEmailHtml(digest)));
    if (res.sent) {
      emailed++;
      await admin.from("sent_notifications").upsert(
        [{ user_id: uid, dedupe_key: weekKey }],
        { onConflict: "user_id,dedupe_key", ignoreDuplicates: true }
      );
    }
  }

  const summary = { emailed, users: enabled.size };
  await recordSyncRun(admin, "digest", startedAt, summary);
  return Response.json(summary);
}
