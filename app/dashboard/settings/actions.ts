"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// Permanently delete the signed-in user and all of their data. Every user-owned table
// (profiles, portfolios + their transactions/options/cash/value-history, broker connections
// and accounts, notification prefs) is ON DELETE CASCADE from auth.users, so removing the
// auth user removes everything they own. Shared reference data (instruments, prices,
// dividends) is global and intentionally untouched.
export async function deleteAccount(formData: FormData) {
  const confirmText = String(formData.get("confirm") ?? "").trim();
  if (confirmText !== "DELETE") {
    // The UI gates on this too; this is the server-side guard.
    return;
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();
  const { error } = await admin.auth.admin.deleteUser(user.id);
  if (error) throw new Error(error.message);

  // Clear the local session cookies, then land on the marketing page.
  await supabase.auth.signOut();
  redirect("/");
}
