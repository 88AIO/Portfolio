// The server-side 2FA gate's decision, kept apart from proxy.ts so it can be tested.

/**
 * Whether this session still owes its second factor, decided only from what the auth server
 * verified. `mfa.getAuthenticatorAssuranceLevel()` without arguments reads the enrolled factors from
 * the session cookie's copy of the user, which the browser can edit: emptying that list made an
 * account with 2FA look like one without, so a password alone passed the gate. The factors here
 * come from `getUser()`'s server response, and the level from the access token that same call just
 * validated (a token claiming aal2 can't be minted without completing the second factor). Anything
 * unreadable fails closed.
 */
export async function needsSecondFactor(
  supabase: { auth: { getSession(): Promise<{ data: { session: { access_token: string } | null } }> } },
  user: { factors?: { status: string }[] | null },
): Promise<boolean> {
  const enrolled = (user.factors ?? []).some((f) => f.status === "verified");
  if (!enrolled) return false;
  const { data: { session } } = await supabase.auth.getSession();
  return tokenClaim(session?.access_token, "aal") !== "aal2";
}

/** One claim from a JWT's payload (not verified here; the caller relies on a prior server check). */
export function tokenClaim(token: string | undefined, name: string): unknown {
  try {
    const payload = token?.split(".")[1];
    if (!payload) return undefined;
    const json = atob(payload.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(payload.length / 4) * 4, "="));
    return (JSON.parse(json) as Record<string, unknown>)[name];
  } catch {
    return undefined;
  }
}
