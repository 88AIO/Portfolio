// Sentry for the Node runtime (route handlers, server actions, crons). Loaded by instrumentation.ts.
import * as Sentry from "@sentry/nextjs";
import { SENTRY_BASE_OPTIONS } from "@/lib/observability";

Sentry.init({ ...SENTRY_BASE_OPTIONS });
