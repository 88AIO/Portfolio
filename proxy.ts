import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// Refreshes the Supabase auth session on every request and guards /dashboard.
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

  // Protect the app; bounce signed-out users to /login
  if (path.startsWith("/dashboard") && !user) {
    return NextResponse.redirect(new URL("/login", request.url));
  }
  // Signed-in users skip the login page
  if (path === "/login" && user) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }
  return response;
}

export const config = {
  // Only the routes that actually need a session: the app (guard + token refresh), the login
  // bounce, and the auth flows (callback/reset). Marketing/blog/legal pages are static and
  // anonymous — matching them made every signed-in visitor pay a Supabase auth round trip per
  // navigation for pages that never read the result. Server pages and API routes refresh sessions
  // themselves via lib/supabase/server.ts, so nothing else depends on the middleware running.
  matcher: ["/dashboard/:path*", "/login", "/auth/:path*"],
};
