// Broker-sync port (public entry point). Only SnapTrade for now; swap/add providers here later.
import type { BrokerSyncProvider } from "./types";
import { snaptradeProvider } from "./providers/snaptrade";

export type { BrokerAccount, BrokerPosition, BrokerSyncProvider, BrokerOptionLeg } from "./types";

export function getBrokerProvider(): BrokerSyncProvider {
  return snaptradeProvider;
}

export function isBrokerSyncConfigured(): boolean {
  return snaptradeProvider.isConfigured();
}

// SECURITY: the SnapTrade integration authenticates with a single *personal* API key, so it can
// only ever read ONE real person's brokerage accounts (the key owner's). In a multi-user app that
// means any signed-in user who synced would pull the OWNER's real accounts into their dashboard.
// Until a per-user SnapTrade connection flow (registerUser + userSecret + connect portal) exists,
// broker sync is restricted to the owner's own account(s), listed in BROKER_SYNC_OWNER_EMAILS
// (comma-separated). If that env var is unset, broker sync is disabled for everyone — a safe
// default that never leaks, rather than an open door.
export function isBrokerSyncOwner(email: string | null | undefined): boolean {
  const allow = (process.env.BROKER_SYNC_OWNER_EMAILS || "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  if (allow.length === 0) return false;
  return !!email && allow.includes(email.toLowerCase());
}
