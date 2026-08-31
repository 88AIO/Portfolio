// The signed-in user, resolved once per server request.
//
// Every dashboard render used to make three round trips to Supabase Auth before a single row of
// data was fetched: proxy.ts validates the session, the page calls getUser(), and ensurePortfolio()
// calls it again. Each is a network hop to the auth server, and they run in sequence, so the user
// waits for all three before the page even starts loading their holdings.
//
// Two changes here:
//
//   • React's cache() dedupes within a single render pass, so a page and every helper it calls
//     share one lookup instead of repeating it.
//   • getClaims() verifies the JWT locally against the project's JWKS when asymmetric signing keys
//     are enabled, which removes the network hop entirely. On the legacy shared-secret setup it
//     falls back to a getUser() call internally — so this is never weaker, and never slower, than
//     what it replaces.
//
// proxy.ts keeps its own getUser(): that call is the security boundary and it also refreshes the
// session cookie, which local verification cannot do. This helper is for reads that happen after
// the middleware has already vouched for the request.
import { cache } from "react";
import { createClient } from "./server";

export type CurrentUser = { id: string; email: string | null };

export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (error || !claims?.sub) return null;
  return {
    id: String(claims.sub),
    email: typeof claims.email === "string" ? claims.email : null,
  };
});
