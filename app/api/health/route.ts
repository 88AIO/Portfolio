import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

// The dead-man's switch. Every other failure signal here is sent BY the job that failed — a cron
// that never fires (schedule disabled, CRON_SECRET rotated in one place, a bad deploy, a paused
// project) sends nothing, and the first sign was a "prices as of" label drifting into last week.
// This endpoint answers from sync_runs instead: 200 while the nightly sync is fresh and healthy,
// 503 once it is stale or its last run synced too little — so a free external uptime monitor
// pointed at /api/health turns silence into a page. Public and unauthenticated by design, so it
// says only whether the sync is healthy and when it last ran: no provider name, call counts or
// error text. Those describe the stack to anyone who asks; they live in sync_runs and the ops email.
const STALE_AFTER_HOURS = 30; // the sync runs daily; one missed night plus slack
const MIN_SYNCED_RATIO = 0.9;

type Run = { started_at: string; summary: Record<string, unknown> | null };

export async function GET() {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("sync_runs")
    .select("started_at, summary")
    .eq("job", "sync")
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const now = Date.now();
  const problems: string[] = [];
  const run = (data ?? null) as Run | null;
  let ageHours: number | null = null;

  if (error) problems.push("the sync record is unreadable");
  else if (!run) problems.push("no nightly sync has ever been recorded");
  else {
    ageHours = (now - Date.parse(run.started_at)) / 3_600_000;
    if (!Number.isFinite(ageHours) || ageHours > STALE_AFTER_HOURS) {
      problems.push(`last nightly sync started ${Number.isFinite(ageHours) ? ageHours!.toFixed(1) : "?"}h ago (limit ${STALE_AFTER_HOURS}h)`);
    }
    const s = run.summary ?? {};
    const total = Number(s.total ?? 0);
    const synced = Number(s.synced ?? 0);
    const quotesWritten = s.quotesWritten == null ? null : Number(s.quotesWritten);
    if (s.aborted) problems.push("the last sync aborted");
    if (s.error) problems.push("the last sync failed");
    if (total > 0 && synced < total * MIN_SYNCED_RATIO) problems.push(`only ${synced} of ${total} instruments synced`);
    if (total > 0 && quotesWritten != null && quotesWritten < total * MIN_SYNCED_RATIO) {
      problems.push(`only ${quotesWritten} of ${total} instruments received a price`);
    }
  }

  const body = {
    ok: problems.length === 0,
    checkedAt: new Date(now).toISOString(),
    lastSyncAt: run?.started_at ?? null,
    lastSyncAgeHours: ageHours == null ? null : Math.round(ageHours * 10) / 10,
    problems,
  };
  return Response.json(body, {
    status: body.ok ? 200 : 503,
    headers: { "Cache-Control": "no-store" },
  });
}
