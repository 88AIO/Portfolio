import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Handles the redirect from email-confirmation, OAuth, and password-recovery links.
// Exchanges the code for a session, then lands the user on `next` (default: the dashboard).
// `next` is constrained to same-origin relative paths so it can't be used as an open redirect.
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const nextParam = searchParams.get("next");
  const next = nextParam && nextParam.startsWith("/") && !nextParam.startsWith("//") ? nextParam : "/dashboard";

  if (code) {
    const supabase = await createClient();
    await supabase.auth.exchangeCodeForSession(code);
  }
  return NextResponse.redirect(`${origin}${next}`);
}
