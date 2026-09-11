import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// Refreshes the Supabase auth session on every request and guards /dashboard and the
// session-authenticated API routes (exports, backfill).
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const { data: { user } } = await supabase.auth.getUser();
  const path = request.nextUrl.pathname;
  const isApi = path.startsWith("/api/");
  const isApp = path.startsWith("/dashboard") || isApi;

  // Where to send someone who still has to sign in (or clear their second factor). Pages get
  // bounced to /login and come back to the page they asked for — an alert email's deep link or the
  // contact page's "settings" link used to land on the overview instead. API routes get a 401: a
  // redirect to an HTML login page is meaningless to a CSV download.
  const toLogin = () => {
    if (isApi) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
    const url = new URL("/login", request.url);
    const next = request.nextUrl.pathname + request.nextUrl.search;
    if (next !== "/dashboard") url.searchParams.set("next", next);
    return NextResponse.redirect(url);
  };

  if (isApp && !user) return toLogin();

  // A password sign-in alone issues a real, valid session cookie — MFA is a second call the login
  // page makes afterward, not a gate on the cookie itself. Without this check, anyone who enrolled
  // in 2FA but has a stray aal1 session (a stolen cookie, a bookmark hit mid-flow) could reach
  // /dashboard — or download their whole ledger from /api/export — having only ever proven the
  // password. The login page's own mount check sends them straight back into the code-entry step
  // instead of the password form.
  if (isApp && user) {
    const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (aal && aal.nextLevel === "aal2" && aal.currentLevel !== aal.nextLevel) return toLogin();
  }

  // Signed-in users skip the login page — but not mid-MFA: they still need to clear aal2 there.
  if (path === "/login" && user) {
    const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    const needsMfa = aal && aal.nextLevel === "aal2" && aal.currentLevel !== aal.nextLevel;
    if (!needsMfa) {
      return NextResponse.redirect(new URL("/dashboard", request.url));
    }
  }
  return response;
}

export const config = {
  // Only the routes that actually need a session: the app (guard + token refresh), the
  // session-authenticated API routes, the login bounce, and the auth flows (callback/reset).
  // Marketing/blog/legal pages are static and anonymous — matching them made every signed-in
  // visitor pay a Supabase auth round trip per navigation for pages that never read the result.
  // The cron routes are excluded on purpose: they authenticate with CRON_SECRET, not a session,
  // and /api/health is public by design.
  matcher: ["/dashboard/:path*", "/api/export/:path*", "/api/backfill", "/login", "/auth/:path*"],
};
