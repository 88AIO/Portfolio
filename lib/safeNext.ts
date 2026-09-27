// Where to send someone after sign-in or an email link. `next` comes from the URL, so anything that
// would leave this site must fall back to the dashboard. A prefix check alone is not enough: the
// URL parser treats "\" as "/" and drops tabs/newlines, so "/\evil.example" and "/\t/evil.example"
// both pass `startsWith("/") && !startsWith("//")` and still resolve to another host. Resolving
// against a throwaway origin and checking it survived is the test that matches what the browser
// (and Next's router) will actually do.
const PROBE_ORIGIN = "https://same-origin.invalid";

export function safeNextPath(raw: string | null | undefined, fallback = "/dashboard"): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return fallback;
  if (/[\\\u0000-\u001f\u007f]/.test(raw)) return fallback;
  try {
    const url = new URL(raw, PROBE_ORIGIN);
    if (url.origin !== PROBE_ORIGIN) return fallback;
    return url.pathname + url.search + url.hash;
  } catch {
    return fallback;
  }
}
