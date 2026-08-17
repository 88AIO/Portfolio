// SnapTrade provider — read-only brokerage sync via the official snaptrade-typescript-sdk.
// Uses a PERSONAL API key: the key represents one account, so there's no registerUser / userSecret
// and no connection portal. The user connects brokerages in the SnapTrade dashboard; we read them.
// See docs/SPEC_broker-sync.md.
import { Snaptrade, SnaptradeAuth } from "snaptrade-typescript-sdk";
import type { BrokerAccount, BrokerActivity, BrokerSyncProvider } from "../types";

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

function isoDate(d: string | null | undefined): string | null {
  if (!d) return null;
  const s = String(d);
  return s.length >= 10 ? s.slice(0, 10) : s;
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

  async getActivities(accountId, since): Promise<BrokerActivity[]> {
    const snap = getClient();
    if (!snap) return [];
    const res = await snap.accountInformation.getAccountActivities({
      accountId,
      ...(since ? { startDate: since } : {}),
    });
    const rows = res.data?.data ?? [];
    return rows.map((a): BrokerActivity => {
      const sym = a.symbol as unknown as { symbol?: string; raw_symbol?: string } | null;
      const cur = a.currency as unknown as { code?: string } | null;
      return {
        id: a.id ?? "",
        type: (a.type ?? "").toUpperCase(),
        symbol: sym?.symbol ?? sym?.raw_symbol ?? null,
        units: typeof a.units === "number" ? a.units : null,
        price: typeof a.price === "number" ? a.price : null,
        amount: typeof a.amount === "number" ? a.amount : null,
        currency: cur?.code ?? null,
        tradeDate: isoDate(a.trade_date),
      };
    });
  },
};
