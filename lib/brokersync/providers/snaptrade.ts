// SnapTrade provider — read-only brokerage sync via the official snaptrade-typescript-sdk.
// Uses a PERSONAL API key: the key represents one account, so there's no registerUser / userSecret
// and no connection portal. The user connects brokerages in the SnapTrade dashboard; we read their
// current positions (authoritative "what I hold") rather than reconstructing from trade history.
// See docs/SPEC_broker-sync.md.
import { Snaptrade, SnaptradeAuth } from "snaptrade-typescript-sdk";
import type { BrokerAccount, BrokerPosition, BrokerSyncProvider } from "../types";

function buildClient() {
  const clientId = process.env.SNAPTRADE_CLIENT_ID;
  const consumerKey = process.env.SNAPTRADE_CONSUMER_KEY;
  if (!clientId || !consumerKey) return null;
  return new Snaptrade({ auth: SnaptradeAuth.personalApiKey({ clientId, consumerKey }) });
}

let cached: ReturnType<typeof buildClient> | undefined;

function getClient() {
  if (cached === undefined) cached = buildClient();
  return cached;
}

// Ticker lives at position.symbol.symbol.(raw_symbol|symbol); handle flat/nested defensively.
function extractTicker(s: unknown): string | null {
  if (!s || typeof s !== "object") return null;
  const o = s as { symbol?: unknown; raw_symbol?: string };
  if (typeof o.raw_symbol === "string") return o.raw_symbol;
  if (typeof o.symbol === "string") return o.symbol;
  if (o.symbol && typeof o.symbol === "object") {
    const inner = o.symbol as { symbol?: string; raw_symbol?: string };
    return inner.raw_symbol ?? inner.symbol ?? null;
  }
  return null;
}

export const snaptradeProvider: BrokerSyncProvider = {
  name: "snaptrade",

  isConfigured() {
    return getClient() != null;
  },

  dashboardUrl() {
    return "https://dashboard.snaptrade.com/home";
  },

  async listAccounts(): Promise<BrokerAccount[]> {
    const snap = getClient();
    if (!snap) return [];
    const res = await snap.accountInformation.listUserAccounts();
    return (res.data ?? []).map((a) => ({
      id: a.id,
      brokerageName: a.institution_name ?? "Brokerage",
      number: a.number ?? "",
    }));
  },

  async getPositions(accountId): Promise<BrokerPosition[]> {
    const snap = getClient();
    if (!snap) return [];
    const res = await snap.accountInformation.getUserHoldings({ accountId });
    const positions = res.data?.positions ?? [];
    return positions.map((p): BrokerPosition => {
      const cur = p.currency as unknown as { code?: string } | null;
      return {
        symbol: extractTicker(p.symbol),
        units: typeof p.units === "number" ? p.units : null,
        price: typeof p.price === "number" ? p.price : null,
        avgCost: typeof p.average_purchase_price === "number" ? p.average_purchase_price : null,
        openPnl: typeof p.open_pnl === "number" ? p.open_pnl : null,
        currency: cur?.code ?? null,
      };
    });
  },
};
