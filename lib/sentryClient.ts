// Sentry in the browser, loaded after the page instead of before it.
//
// The SDK is ~55 KB of compressed JavaScript — a quarter of what every page shipped — and loading
// it up front made each page parse and run it before it could respond. It now arrives once the
// page has loaded (instrumentation-client.ts) or the moment something needs to report, whichever
// comes first. Errors thrown before it arrives are queued there and sent when it does.
import { SENTRY_BASE_OPTIONS } from "@/lib/observability";

type SentryModule = typeof import("./sentryBrowser");

let loading: Promise<SentryModule> | null = null;

/** The Sentry SDK, loaded and initialized once. */
export function sentryClient(): Promise<SentryModule> {
  loading ??= import("./sentryBrowser").then((Sentry) => {
    if (!Sentry.getClient()) Sentry.init({ ...SENTRY_BASE_OPTIONS });
    return Sentry;
  });
  return loading;
}

/** Report an error without holding up the caller; never throws. */
export function reportError(error: unknown): void {
  sentryClient()
    .then((Sentry) => Sentry.captureException(error))
    .catch(() => {});
}
