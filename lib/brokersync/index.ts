// Broker-sync port (public entry point). Only SnapTrade for now; swap/add providers here later.
import type { BrokerSyncProvider } from "./types";
import { snaptradeProvider } from "./providers/snaptrade";

export type { BrokerAccount, BrokerActivity, BrokerSyncProvider } from "./types";

export function getBrokerProvider(): BrokerSyncProvider {
  return snaptradeProvider;
}

export function isBrokerSyncConfigured(): boolean {
  return snaptradeProvider.isConfigured();
}
