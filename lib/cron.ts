// Shared support for the scheduled jobs: run recording + cross-user email lookup.
// Vercel discards cron response bodies and Hobby log retention is ~1 hour, so without a record a
// dead cron, a partial sync, or provider throttling is invisible forever. Everything here is
// best-effort by contract — observability must never fail the job it observes.
import type { createAdminClient } from "@/lib/supabase/admin";

type Admin = ReturnType<typeof createAdminClient>;

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

// All users' emails by id, paged past supabase's listUsers default page size (~50) — a single
// unpaginated listUsers() call silently drops everyone beyond page 1 once the app grows.
export async function listAllUserEmails(admin: Admin): Promise<Map<string, string>> {
  const emails = new Map<string, string>();
  const perPage = 200;
  for (let page = 1; ; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) {
      console.error("[cron] listUsers failed:", error.message);
      break;
    }
    for (const u of data?.users ?? []) if (u.email) emails.set(u.id, u.email);
    if (!data?.users?.length || data.users.length < perPage) break;
  }
  return emails;
}
