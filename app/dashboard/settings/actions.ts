"use server";

import { redirect } from "next/navigation";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { fail, type ActionResult } from "@/lib/actionResult";

// Permanently delete the signed-in user and all of their data. Every user-owned table
// (profiles, portfolios + their transactions/options/cash/value-history, broker connections
// and accounts, notification prefs) is ON DELETE CASCADE from auth.users, so removing the
// auth user removes everything they own. Shared reference data (instruments, prices,
// dividends) is global and intentionally untouched.
//
// Irreversible, so it needs more than a live session cookie: the current password is verified
// against the auth server first. A session left open on a shared machine, or a stolen cookie,
// should not be enough to erase years of records.
export async function deleteAccount(formData: FormData): Promise<ActionResult | void> {
  const confirmText = String(formData.get("confirm") ?? "").trim();
  if (confirmText !== "DELETE") {
    // The UI gates on this too; this is the server-side guard.
    return fail("Type DELETE to confirm.");
  }
  const password = String(formData.get("password") ?? "");
  if (!password) return fail("Enter your current password to confirm.");

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (!user.email) return fail("This account has no email address to verify against.");

  // Re-authenticate with a throwaway client so the check never touches the live session cookie.
  const verifier = createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
  const { data: check, error: checkError } = await verifier.auth.signInWithPassword({ email: user.email, password });
  if (checkError || check.user?.id !== user.id) return fail("That password didn't match.");
  // Don't leave the verification session alive server-side.
  await verifier.auth.signOut({ scope: "local" }).catch(() => {});

  const admin = createAdminClient();
  const { error } = await admin.auth.admin.deleteUser(user.id);
  if (error) return fail("We couldn't delete the account just now. Nothing was changed — please try again.");

  // Clear this device's session cookies, then land on the marketing page. The user no longer
  // exists, so a global sign-out has nothing to revoke.
  await supabase.auth.signOut({ scope: "local" });
  redirect("/");
}
