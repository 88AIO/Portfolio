// Sentry for the edge runtime, should any route opt into it. Loaded by instrumentation.ts.
import * as Sentry from "@sentry/nextjs";
import { SENTRY_BASE_OPTIONS } from "@/lib/observability";

Sentry.init({ ...SENTRY_BASE_OPTIONS });
