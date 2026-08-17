// SnapTrade provider — read-only brokerage sync via the official snaptrade-typescript-sdk.
// Credentials (clientId/consumerKey) are server-only env vars; the user's brokerage login
// happens inside SnapTrade's portal and never reaches Snowfolio. See docs/SPEC_broker-sync.md.
import { Snaptrade, SnaptradeAuth } from "snaptrade-typescript-sdk";
import type { BrokerActivity, BrokerSyncProvider } from "../types";

function buildClient() {
  const clientId = process.env.SNAPTRADE_CLIENT_ID;
  const consumerKey = process.env.SNAPTRADE_CONSUMER_KEY;
  if (!clientId || !consumerKey) return null;
  return new Snaptrade({ auth: SnaptradeAuth.commercialApiKey({ clientId, consumerKey }) });
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

  async registerUser(userId) {
    const snap = getClient();
    if (!snap) throw new Error("SnapTrade is not configured.");
    const res = await snap.authentication.registerSnapTradeUser({ userId });
    return { userId: res.data.userId ?? userId, userSecret: res.data.userSecret ?? "" };
  },

  async getConnectPortalUrl(userId, userSecret, redirectUri) {
    const snap = getClient();
    if (!snap) return null;
    const res = await snap.authentication.loginSnapTradeUser({
      userId,
      userSecret,
      ...(redirectUri ? { customRedirect: redirectUri } : {}),
    });
    const data = res.data as unknown as { redirectURI?: string };
    return data.redirectURI ?? null;
  },

  async listAccounts(userId, userSecret) {
    const snap = getClient();
    if (!snap) return [];
    const res = await snap.accountInformation.listUserAccounts({ userId, userSecret });
    return (res.data ?? []).map((a) => ({
      id: a.id,
      brokerageName: a.institution_name ?? "Brokerage",
      number: a.number ?? "",
    }));
  },

  async getActivities(userId, userSecret, accountId, since) {
    const snap = getClient();
    if (!snap) return [];
    const res = await snap.accountInformation.getAccountActivities({
      accountId,
      userId,
      userSecret,
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
