// Sentry in the browser, loaded only when something needs reporting.
//
// The SDK is ~60 KB of compressed JavaScript — a quarter of what every page shipped — and running
// it on every visit blocked the main thread for 100–190 ms on a mid-range phone, even deferred to
// idle time. It now arrives on the first uncaught error (instrumentation-client.ts) or the first
// error boundary that reports, like Sentry's own lazy loader. The trade: no breadcrumbs from
// before the error, and no session-based release health (not used here).
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
