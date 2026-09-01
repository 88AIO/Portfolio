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
  // SnapTrade's own transaction-sync status for this account — the definitive read on why the
  // activities feed is (or isn't) populated: whether the initial backfill finished, and the
  // earliest transaction SnapTrade holds. null when the provider doesn't report it.
  txnSync?: { initialDone: boolean | null; firstDate: string | null; lastSync: string | null };
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
  // Providers that don't expose an activities feed simply omit this. Returns diagnostics alongside
  // the legs so a caller can tell "no options traded" (scanned>0, legs=0) from "the call failed"
  // (error set) — otherwise both look like an empty result.
  // Optional: read the account's full transaction history (one fetch), returning both the
  // seller-flow option legs and the real-dated equity transactions (buys/sells/dividends).
  getActivities?(accountId: string, since?: string): Promise<BrokerActivitiesResult>;
  // Optional: read CURRENT open option positions from the positions feed (works even when the
  // transactions feed is empty). Returns short seller legs plus diagnostics.
  getOptionPositions?(accountId: string): Promise<BrokerOptionPositionResult>;
}

// One real, dated equity transaction from the broker's activity feed.
export type BrokerEquityTxn = {
  symbol: string;
  exchange: string; // normalized code, resolved the SAME way as positions so instrument ids match
  name: string | null;
  txnType: "buy" | "sell" | "dividend";
  quantity: number; // shares (buys/sells); 1 for a dividend (price carries the cash amount)
  price: number; // per share (buys/sells); total dividend cash for a dividend row
  fee: number;
  currency: string;
  tradeDate: string; // YYYY-MM-DD
  ref: string; // stable broker/SnapTrade activity id, for idempotent dedupe
  /** True when this buy was funded by a dividend the broker reinvested. */
  drip?: boolean;
};

export type BrokerActivitiesResult = {
  optionLegs: BrokerOptionLeg[];
  equityTxns: BrokerEquityTxn[];
  scanned: number; // total activity rows fetched from the provider (all types)
  optionRows: number; // rows that were option events (before seller-flow filtering)
  equityRows: number; // rows that were equity buys/sells/dividends
  error?: string; // set when the provider call threw / was rejected
  shape?: string; // debug: top-level response keys when the feed came back empty (to spot a mis-read)
  /** debug: how the feed actually shapes DIVIDEND rows, so reinvestments can be told from payouts. */
  divShape?: string;
};

// (BrokerOptionActivityResult removed — getActivities now returns options + equity together.)

export type BrokerOptionPositionResult = {
  legs: BrokerOptionLeg[];
  positions: number; // total positions scanned in the feed
  optionPositions: number; // how many were option contracts (short + long)
  sample?: string; // debug: keys of the first option position seen (to verify field mapping)
  error?: string;
};
