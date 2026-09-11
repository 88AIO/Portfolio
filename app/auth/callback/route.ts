import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Handles the redirect from email-confirmation and password-recovery links (and OAuth, if a
// provider is ever enabled). Exchanges the code for a session, then lands the user on `next`
// (default: the dashboard). `next` is constrained to same-origin relative paths so it can't be
// used as an open redirect.
//
// A failed exchange (an expired or already-used link) used to redirect to /dashboard anyway, where
// the middleware bounced the signed-out visitor to a bare "Welcome back" with no explanation.
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const nextParam = searchParams.get("next");
  const next = nextParam && nextParam.startsWith("/") && !nextParam.startsWith("//") ? nextParam : "/dashboard";

  if (!code) return NextResponse.redirect(`${origin}/login?error=callback`);

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    const reason = /expired|invalid|used/i.test(error.message) ? "link_expired" : "callback";
    return NextResponse.redirect(`${origin}/login?error=${reason}`);
  }
  return NextResponse.redirect(`${origin}${next}`);
}
