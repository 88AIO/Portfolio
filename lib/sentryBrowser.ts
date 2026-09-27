// The three pieces of the Sentry SDK the browser uses, re-exported by name so the lazily loaded
// chunk (lib/sentryClient.ts) carries only them. Importing the package namespace dynamically
// defeats tree-shaking and drags in replay, feedback and tracing code that is switched off.
export { init, captureException, getClient } from "@sentry/nextjs";
