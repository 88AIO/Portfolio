// Broker-sync provider port — shared types.
// A different aggregator (Plaid, per-broker APIs) can implement BrokerSyncProvider later.
// Read-only by design: no trading. See docs/SPEC_broker-sync.md.

export type BrokerAccount = {
  id: string;
  brokerageName: string;
  number: string;
};

export type BrokerActivity = {
  id: string;
  type: string; // BUY | SELL | DIVIDEND | CONTRIBUTION | WITHDRAWAL | ...
  symbol: string | null;
  units: number | null;
  price: number | null;
  amount: number | null;
  currency: string | null;
  tradeDate: string | null; // YYYY-MM-DD
};

export interface BrokerSyncProvider {
  readonly name: string;
  isConfigured(): boolean;
  registerUser(userId: string): Promise<{ userId: string; userSecret: string }>;
  getConnectPortalUrl(userId: string, userSecret: string, redirectUri?: string): Promise<string | null>;
  listAccounts(userId: string, userSecret: string): Promise<BrokerAccount[]>;
  getActivities(userId: string, userSecret: string, accountId: string, since?: string): Promise<BrokerActivity[]>;
}
