// Per-user caps on the server actions that cost something: a provider call (quotes, dividends,
// history, option chains, splits) or an email from our domain. The shared caches already bound
// what ordinary use can spend; these limits bound what a script calling an action in a loop can.
// Counting happens in Postgres (public.hit_rate_limit, supabase/schema.sql §14) so every
// serverless instance sees the same counter, and only the service role may call it — a user who
// could pass their own window could reset their own counter between requests.
import { createAdminClient } from "@/lib/supabase/admin";

export type RateRule = { bucket: string; limit: number; windowSeconds: number };

// Sized well above anything a person does by hand, so only a loop ever meets them.
export const RATE_LIMITS = {
  addTransaction: { bucket: "add-transaction", limit: 20, windowSeconds: 60 },
  addOption: { bucket: "add-option", limit: 20, windowSeconds: 60 },
  importCsv: { bucket: "import-csv", limit: 5, windowSeconds: 600 },
  refreshPrices: { bucket: "refresh-prices", limit: 6, windowSeconds: 600 },
  putFinder: { bucket: "put-finder", limit: 10, windowSeconds: 600 },
  checkSplits: { bucket: "check-splits", limit: 10, windowSeconds: 600 },
  testEmail: { bucket: "test-email", limit: 3, windowSeconds: 600 },
} as const satisfies Record<string, RateRule>;

export const RATE_LIMITED_MESSAGE = "That's a lot of requests in a short time. Give it a minute, then try again.";

/**
 * Count one use of `rule` for this user; false once they are over the limit for the window.
 * Fails open: if the counter can't be reached, the action runs. A rate limiter that takes the app
 * down with it is worse than the abuse it exists to slow, and the error is logged for Sentry.
 */
export async function allowAction(userId: string, rule: RateRule): Promise<boolean> {
  const { data, error } = await createAdminClient().rpc("hit_rate_limit", {
    p_user: userId,
    p_bucket: rule.bucket,
    p_limit: rule.limit,
    p_window_seconds: rule.windowSeconds,
  });
  if (error) {
    console.error(`[rate-limit] ${rule.bucket}: ${error.message}`);
    return true;
  }
  return data !== false;
}
