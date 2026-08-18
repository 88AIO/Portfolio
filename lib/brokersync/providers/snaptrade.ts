// SnapTrade provider — read-only brokerage sync via the official snaptrade-typescript-sdk.
// Uses a PERSONAL API key: the key represents one account, so there's no registerUser / userSecret
// and no connection portal. Reads current positions (the /positions endpoint — the deprecated
// /holdings endpoint returns 410 Gone for accounts created after May 2026). See docs/SPEC_broker-sync.md.
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

// Ticker lives on the instrument object as raw_symbol/symbol; handle flat/nested defensively.
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
    const accounts = res.data ?? [];
    // Temporary diagnostic: what account-type fields the broker returns (to pick the best label).
    console.log(
      "[broker-accounts]",
      accounts
        .map((a) => `${a.number}: name=${a.name ?? "-"} raw_type=${a.raw_type ?? "-"} cat=${a.account_category ?? "-"}`)
        .join(" | ")
    );
    return accounts.map((a) => ({
      id: a.id,
      brokerageName: a.institution_name ?? "Brokerage",
      number: a.number ?? "",
      label: (a.name || a.raw_type || a.account_category || "").toString().trim(),
    }));
  },

  async getPositions(accountId): Promise<BrokerPosition[]> {
    const snap = getClient();
    if (!snap) return [];
    try {
      const res = await snap.accountInformation.getAllAccountPositions({ accountId });
      const results = res.data?.results ?? [];
      return results
        .filter((p) => !p.cash_equivalent)
        .map((p): BrokerPosition => {
          const units = p.units != null ? Number(p.units) : NaN;
          const priceNum = p.price != null ? Number(p.price) : NaN;
          const costBasis = p.cost_basis != null ? Number(p.cost_basis) : NaN;
          // SnapTrade's cost_basis is already the per-share average cost (not the position total).
          const avgCost = isFinite(costBasis) ? costBasis : null;
          return {
            symbol: extractTicker(p.instrument),
            units: isFinite(units) ? units : null,
            price: isFinite(priceNum) ? priceNum : null,
            avgCost,
            currency: typeof p.currency === "string" ? p.currency : null,
          };
        });
    } catch {
      // One account failing (e.g. a disabled connection) shouldn't abort syncing the others.
      return [];
    }
  },
};
