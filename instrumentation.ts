// Next.js instrumentation hook: runs once per server runtime at boot. Loads the matching Sentry
// config, and hands Next's server-side render/route errors (the ones the error boundaries only see
// as a digest) to Sentry with the request context attached.
import * as Sentry from "@sentry/nextjs";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") await import("./sentry.server.config");
  if (process.env.NEXT_RUNTIME === "edge") await import("./sentry.edge.config");
}

export const onRequestError = Sentry.captureRequestError;
