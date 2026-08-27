import { createAdminClient } from "@/lib/supabase/admin";
import { computeOption, type OptionPositionRow } from "@/lib/options";
import { buildAlerts, alertsEmailHtml, type PositionLite } from "@/lib/notifications/build";
import { sendEmail, emailShell, emailConfig, reportEmailFailure } from "@/lib/email";
import { fetchAll } from "@/lib/supabase/paginate";
import { recordSyncRun, listAllUserEmails } from "@/lib/cron";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Daily options/dividend alerts. For each user who opted in, detect assignment risk, near expiries,
// and upcoming ex-dividends, skip anything already emailed (sent_notifications), and send one
// summary email. CRON_SECRET-guarded; fails closed.

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  return !!secret && request.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(request: Request) {
  if (!authorized(request)) return new Response("Unauthorized", { status: 401 });
  const startedAt = Date.now();
  const admin = createAdminClient();
  const today = new Date().toISOString().slice(0, 10);

  // Cross-user reads (service role bypasses RLS) — page past the ~1000-row cap so no user's
  // positions/options are dropped and no assignment/expiry/ex-dividend alert is silently missed.
  const [prefs, portfolios, posData, optData] = await Promise.all([
    fetchAll<{ user_id: string }>((f, t) =>
      admin.from("notification_prefs").select("user_id").eq("email_alerts", true).order("user_id").range(f, t)),
    fetchAll<{ id: string; user_id: string }>((f, t) =>
      admin.from("portfolios").select("id, user_id").order("id").range(f, t)),
    fetchAll<PositionLite & { portfolio_id: string }>((f, t) =>
      admin.from("positions").select("portfolio_id, symbol, currency, shares, next_dividend_date, next_dividend_per_share, annual_div_per_share, div_frequency").order("portfolio_id").order("instrument_id").range(f, t)),
    fetchAll<OptionPositionRow & { portfolio_id: string }>((f, t) =>
      admin.from("option_positions").select("*").order("portfolio_id").order("instrument_id").order("option_type").order("strike").order("expiration").range(f, t)),
  ]);

  const userByPortfolio = new Map<string, string>(portfolios.map((p) => [p.id, p.user_id]));
  const enabledUsers = new Set(prefs.map((r) => r.user_id));

  // Group positions + option rows by user.
  const posByUser = new Map<string, PositionLite[]>();
  for (const p of (posData ?? []) as (PositionLite & { portfolio_id: string })[]) {
    const uid = userByPortfolio.get(p.portfolio_id);
    if (!uid || !enabledUsers.has(uid)) continue;
    (posByUser.get(uid) ?? posByUser.set(uid, []).get(uid)!).push(p);
  }
  const optByUser = new Map<string, OptionPositionRow[]>();
  for (const o of (optData ?? []) as (OptionPositionRow & { portfolio_id: string })[]) {
    const uid = userByPortfolio.get(o.portfolio_id);
    if (!uid || !enabledUsers.has(uid)) continue;
    (optByUser.get(uid) ?? optByUser.set(uid, []).get(uid)!).push(o);
  }

  // One paginated email map instead of a getUserById round trip per user (breaks past ~50 users).
  const emailById = await listAllUserEmails(admin);

  let emailed = 0;
  let emailIssue: string | null = null;
  for (const uid of enabledUsers) {
    const options = (optByUser.get(uid) ?? []).map(computeOption);
    const items = buildAlerts(options, posByUser.get(uid) ?? [], today);
    if (!items.length) continue;

    // Skip events already emailed.
    const keys = items.map((i) => i.dedupeKey);
    const { data: already } = await admin
      .from("sent_notifications").select("dedupe_key").eq("user_id", uid).in("dedupe_key", keys);
    const sentSet = new Set((already ?? []).map((r: { dedupe_key: string }) => r.dedupe_key));
    const fresh = items.filter((i) => !sentSet.has(i.dedupeKey));
    if (!fresh.length) continue;

    const email = emailById.get(uid);
    if (!email) continue;

    const res = await sendEmail(
      email,
      `Snowfolio: ${fresh.length} thing${fresh.length === 1 ? "" : "s"} to know`,
      emailShell("A few heads-ups", alertsEmailHtml(fresh))
    );
    if (res.sent) {
      await admin.from("sent_notifications").upsert(
        fresh.map((i) => ({ user_id: uid, dedupe_key: i.dedupeKey })),
        { onConflict: "user_id,dedupe_key", ignoreDuplicates: true }
      );
      emailed++;
    } else {
      // Keep the first reason only: with a missing key every user fails identically, and one line
      // says it as well as N do.
      emailIssue ??= reportEmailFailure("alerts", res);
    }
  }

  // emailed:0 on its own is ambiguous — it equally means "nobody had alerts today". These two
  // fields disambiguate it without needing a send to have been attempted.
  const summary = { emailed, users: enabledUsers.size, ...emailConfig(), emailIssue };
  await recordSyncRun(admin, "alerts", startedAt, summary);
  return Response.json(summary);
}
