// Broker-sync provider port — shared types. Read-only, positions-based. See docs/SPEC_broker-sync.md.

export type BrokerAccount = {
  id: string;
  brokerageName: string;
  number: string;
};

export type BrokerPosition = {
  symbol: string | null;
  units: number | null;
  price: number | null; // last market price from the broker
  avgCost: number | null; // average purchase price (cost basis)
  currency: string | null;
};

// Personal-API-key model: the key IS the account, so there's no per-user registration or
// connection portal — the user manages connections in the SnapTrade dashboard and we read them.
export interface BrokerSyncProvider {
  readonly name: string;
  isConfigured(): boolean;
  dashboardUrl(): string;
  listAccounts(): Promise<BrokerAccount[]>;
  getPositions(accountId: string): Promise<BrokerPosition[]>;
}
