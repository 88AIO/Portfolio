// Broker-sync provider port — shared types. Read-only, positions-based. See docs/SPEC_broker-sync.md.
import type { BrokerOptionLeg } from "./options";
export type { BrokerOptionLeg } from "./options";

export type BrokerAccount = {
  id: string;
  brokerageName: string;
  number: string;
  label: string; // account name/type from the broker, e.g. "Individual", "Roth IRA" ("" if unknown)
  category: string; // normalized: INVESTMENT | DEPOSIT | LOC ("" if unknown)
  accountType: string; // raw brokerage type string
  cashBalance: number | null; // total/cash balance the broker reports (used for cash accounts)
  currency: string; // balance currency
  isCash: boolean; // true for bank/deposit accounts (route to the cash ledger, not holdings)
  raw?: unknown; // temporary: the raw account object, for shape inspection
};

export type BrokerPosition = {
  symbol: string | null;
  name: string | null; // company/security description from the broker (e.g. "Xiaomi Corp")
  exchange: string | null; // normalized exchange code (US, HK, TW, SS, SZ, SI, KL, …)
  units: number | null;
  price: number | null; // last market price from the broker
  avgCost: number | null; // average purchase price per share (may be null for some brokers)
  currency: string | null;
  assetType: string | null; // e.g. "crypto", "cs" (common stock), "et" (ETF)
  isCrypto: boolean;
};

// Personal-API-key model: the key IS the account, so there's no per-user registration or
// connection portal — the user manages connections in the SnapTrade dashboard and we read them.
export interface BrokerSyncProvider {
  readonly name: string;
  isConfigured(): boolean;
  dashboardUrl(): string;
  listAccounts(): Promise<BrokerAccount[]>;
  getPositions(accountId: string): Promise<BrokerPosition[]>;
  // Optional: read the account's option activity (sold/closed/expired/assigned legs) since a date.
  // Providers that don't expose an activities feed simply omit this.
  getOptionActivities?(accountId: string, since?: string): Promise<BrokerOptionLeg[]>;
}
