// Sentry in the browser. Same options as the server; no replay, no tracing (see lib/observability).
import * as Sentry from "@sentry/nextjs";
import { SENTRY_BASE_OPTIONS } from "@/lib/observability";

Sentry.init({ ...SENTRY_BASE_OPTIONS });

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
