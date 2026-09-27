// Sentry in the browser. Same options as the server; no replay, no tracing (see lib/observability).
// Loaded only when there is something to report (lib/sentryClient.ts), the way Sentry's own lazy
// loader works: most visits never throw, and booting the SDK on every page cost a mid-range phone
// 100–190 ms of blocked main thread plus 62 KB it never used. The error that triggers the load is
// held here, with anything else thrown while it arrives, and sent once it has.
import { sentryClient } from "@/lib/sentryClient";

const early: unknown[] = [];
let loading = false;

function hold(error: unknown) {
  // Capped: if the SDK can't arrive (offline) a page throwing in a loop must not grow this forever.
  if (early.length < 20) early.push(error);
  if (loading) return;
  loading = true;
  sentryClient()
    .then((Sentry) => {
      // Sentry's own handlers are installed now; stop holding and send what was held.
      removeEventListener("error", onError);
      removeEventListener("unhandledrejection", onRejection);
      for (const err of early.splice(0)) Sentry.captureException(err);
    })
    .catch(() => {});
}

function onError(e: ErrorEvent) {
  // A cross-origin script (usually a browser extension) reports only "Script error." with nothing
  // to act on, and Sentry drops it by default — not worth fetching the SDK for.
  if (!e.error && /^Script error\.?$/.test(e.message)) return;
  hold(e.error ?? new Error(e.message));
}

function onRejection(e: PromiseRejectionEvent) {
  hold(e.reason);
}

addEventListener("error", onError);
addEventListener("unhandledrejection", onRejection);
