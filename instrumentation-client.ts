// Sentry in the browser. Same options as the server; no replay, no tracing (see lib/observability).
// Loaded once the page has finished loading rather than ahead of it (lib/sentryClient.ts); anything
// thrown in the meantime is held here and reported when the SDK arrives.
import { sentryClient } from "@/lib/sentryClient";

const early: unknown[] = [];
const onError = (e: ErrorEvent) => early.push(e.error ?? new Error(e.message));
const onRejection = (e: PromiseRejectionEvent) => early.push(e.reason);
addEventListener("error", onError);
addEventListener("unhandledrejection", onRejection);

function start() {
  sentryClient()
    .then((Sentry) => {
      // Sentry's own handlers are installed now; stop holding and send what was held.
      removeEventListener("error", onError);
      removeEventListener("unhandledrejection", onRejection);
      for (const err of early.splice(0)) Sentry.captureException(err);
    })
    .catch(() => {});
}

// After load, when the browser is idle, so reporting never competes with the page for the main
// thread. The timeout bounds the wait on a page that never goes idle.
const whenIdle = () =>
  "requestIdleCallback" in window ? requestIdleCallback(start, { timeout: 4000 }) : setTimeout(start, 1500);
if (document.readyState === "complete") whenIdle();
else addEventListener("load", whenIdle, { once: true });
