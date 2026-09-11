// Shared support for the scheduled jobs: auth, run recording + cross-user email lookup.
// Vercel discards cron response bodies and platform logs roll off within days, so without a record
// a dead cron, a partial sync, or provider throttling is invisible forever. The recording is
// best-effort by contract — observability must never fail the job it observes — and /api/health
// reads it back so a silent night becomes a failing uptime check.
import { timingSafeEqual } from "node:crypto";
import type { createAdminClient } from "@/lib/supabase/admin";

type Admin = ReturnType<typeof createAdminClient>;

// The one bearer-secret check every scheduled route uses. Fails closed when CRON_SECRET is unset
// (a deployment that forgot it must not become a public trigger for provider fan-out), and compares
// in constant time so the secret can't be recovered a byte at a time from response timing.
export function isCronAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = request.headers.get("authorization") ?? "";
  const expected = Buffer.from(`Bearer ${secret}`);
  const given = Buffer.from(header);
  if (expected.length !== given.length) return false;
  return timingSafeEqual(expected, given);
}

// Where operational alerts go (sync failures, provider misconfiguration). OPS_ALERT_EMAIL first;
// the broker-sync owner list is the fallback so an existing deployment keeps working — but the two
// are different concerns, and turning broker sync off should not silence the ops alerts.
export function opsAlertEmail(): string | null {
  const explicit = process.env.OPS_ALERT_EMAIL?.trim();
  if (explicit) return explicit;
  return (process.env.BROKER_SYNC_OWNER_EMAILS ?? "").split(",")[0]?.trim() || null;
}

// Persist one cron invocation's outcome into sync_runs (see supabase/schema.sql §12).
// Tolerates the table not existing yet (migration not applied) — logs and moves on.
export async function recordSyncRun(
  admin: Admin,
  job: "sync" | "alerts" | "digest" | "backfill",
  startedAtMs: number,
  summary: Record<string, unknown>,
  failedSymbols: string[] = [],
): Promise<void> {
  try {
    const { error } = await admin.from("sync_runs").insert({
      job,
      started_at: new Date(startedAtMs).toISOString(),
      duration_ms: Date.now() - startedAtMs,
      summary,
      failed_symbols: failedSymbols,
    });
    if (error) console.error(`[cron:${job}] sync_runs insert failed:`, error.message);
  } catch (e) {
    console.error(`[cron:${job}] sync_runs insert threw:`, e);
  }
}

// All users' CONFIRMED emails by id, paged past supabase's listUsers default page size (~50) — a
// single unpaginated listUsers() call silently drops everyone beyond page 1 once the app grows.
// Unconfirmed addresses are left out: nothing should be mailed to an address nobody has proven
// they own, and the broker-sync owner allowlist must never match one (anyone could register the
// owner's address and, with confirmation off, inherit the owner's brokerage feed).
export async function listAllUserEmails(admin: Admin): Promise<Map<string, string>> {
  const emails = new Map<string, string>();
  const perPage = 200;
  for (let page = 1; ; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) {
      console.error("[cron] listUsers failed:", error.message);
      break;
    }
    for (const u of data?.users ?? []) if (u.email && u.email_confirmed_at) emails.set(u.id, u.email);
    if (!data?.users?.length || data.users.length < perPage) break;
  }
  return emails;
}
