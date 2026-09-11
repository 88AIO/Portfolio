// Where errors go. A Sentry DSN is a public identifier — it ships inside every browser bundle
// that reports to it — not a secret, so the Snowfolio project's DSN is committed as the default
// and reporting works with no environment setup. Override it to point somewhere else, or set the
// variable to an empty string to switch reporting off. Abuse of a public DSN is limited on the
// Sentry side (project → Client Keys → allowed domains / rate limit), not by hiding it.
export const SENTRY_DSN =
  process.env.NEXT_PUBLIC_SENTRY_DSN ??
  process.env.SENTRY_DSN ??
  "https://477b5ab1fcfdeece8d3816354f06734e@o4511956553236480.ingest.us.sentry.io/4512068829970432";

// production | preview | development on Vercel; falls back to NODE_ENV elsewhere.
export const SENTRY_ENVIRONMENT =
  process.env.NEXT_PUBLIC_VERCEL_ENV ?? process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "development";

// Shared by every runtime's Sentry.init. Errors and the cron monitor are the point; tracing and
// session replay stay off — replay would record a screen full of someone's holdings, and there is
// nobody reading performance traces yet. Turn them on deliberately, not by default.
export const SENTRY_BASE_OPTIONS = {
  dsn: SENTRY_DSN,
  environment: SENTRY_ENVIRONMENT,
  enabled: process.env.NODE_ENV === "production",
  sendDefaultPii: false,
  tracesSampleRate: 0,
} as const;
