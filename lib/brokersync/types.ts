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

// Personal-API-key model: the key IS the account, so there's no per-user registration or
// connection portal — the user manages connections in the SnapTrade dashboard and we just read them.
export interface BrokerSyncProvider {
  readonly name: string;
  isConfigured(): boolean;
  dashboardUrl(): string;
  listAccounts(): Promise<BrokerAccount[]>;
  getActivities(accountId: string, since?: string): Promise<BrokerActivity[]>;
}
