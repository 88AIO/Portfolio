"use server";

import { createClient } from "@/lib/supabase/server";
import { isBrokerSyncOwner } from "@/lib/brokersync";
import { runBrokerSyncForUser, type BrokerSyncResult } from "@/lib/brokersync/run";

// Signed-in entry point (Server Action): verify the caller is the SnapTrade key owner, then run the
// sync for them. The heavy, un-gated core lives in lib/brokersync/run.ts (a plain server module, not
// a Server Action) so it can never be dispatched directly with an attacker-chosen userId.
export async function syncBrokerAccounts(): Promise<BrokerSyncResult> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Not signed in." };

  // SECURITY GATE: the personal-key SnapTrade integration can only read the key owner's real
  // accounts, so it must never run for a non-owner (it would import the owner's holdings into
  // their dashboard). Restrict to BROKER_SYNC_OWNER_EMAILS until a per-user connection flow exists.
  // The allowlist is by email, so the email must be one the person has actually proven they own:
  // with confirmation ever turned off, anyone registering the owner's address would otherwise
  // inherit the owner's real brokerage feed.
  if (!user.email_confirmed_at || !isBrokerSyncOwner(user.email)) {
    return { ok: false, message: "Broker sync is limited to the account owner on this instance." };
  }
  return runBrokerSyncForUser(user.id);
}
