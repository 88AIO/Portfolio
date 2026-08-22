// SnapTrade provider — read-only brokerage sync via the official snaptrade-typescript-sdk.
// Uses a PERSONAL API key: the key represents one account, so there's no registerUser / userSecret
// and no connection portal. Reads current positions (the /positions endpoint — the deprecated
// /holdings endpoint returns 410 Gone for accounts created after May 2026). See docs/SPEC_broker-sync.md.
import { Snaptrade, SnaptradeAuth } from "snaptrade-typescript-sdk";
import type { BrokerAccount, BrokerPosition, BrokerSyncProvider, BrokerOptionLeg, BrokerOptionActivityResult } from "../types";
import { normalizeSnaptradeActivity } from "../options";

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

// Map SnapTrade exchange identifiers (code or MIC) onto our internal exchange codes, which the
// market-data layer turns into Yahoo suffixes. Covers the non-US markets our holdings actually use.
const EXCHANGE_MAP: Record<string, string> = {
  // Hong Kong
  SEHK: "HK", HKEX: "HK", XHKG: "HK", HKG: "HK",
  // Taiwan
  TAI: "TW", TWSE: "TW", TPE: "TW", ROCO: "TW", XTAI: "TW",
  // Shanghai
  SSE: "SS", SHG: "SS", SHH: "SS", SHA: "SS", XSHG: "SS",
  // Shenzhen
  SZSE: "SZ", SHE: "SZ", SHZ: "SZ", XSHE: "SZ",
  // Singapore
  SGX: "SI", SES: "SI", XSES: "SI",
  // Malaysia (Bursa)
  KLS: "KL", MYX: "KL", BURSA: "KL", KLSE: "KL", XKLS: "KL",
  // Thailand
  SET: "BK", XBKK: "BK",
  // Japan
  TSE: "TSE", JPX: "TSE", XTKS: "TSE",
  // London
  LSE: "LSE", XLON: "LSE",
};

// The security's exchange lives on the (possibly nested) symbol object as `exchange.code` /
// `exchange.mic_code`. Return our normalized code; default to US when unknown/not mapped.
function extractExchange(p: unknown): string {
  const pos = p as { instrument?: unknown; symbol?: unknown };
  const s = (pos.instrument ?? pos.symbol) as { symbol?: unknown; exchange?: unknown } | undefined;
  const inner = (s?.symbol && typeof s.symbol === "object" ? s.symbol : s) as
    | { exchange?: { code?: string; mic_code?: string } }
    | undefined;
  const ex = inner?.exchange;
  const code = (ex?.code ?? "").toString().toUpperCase();
  const mic = (ex?.mic_code ?? "").toString().toUpperCase();
  return EXCHANGE_MAP[code] ?? EXCHANGE_MAP[mic] ?? "US";
}

// The human-readable security name/description, from the (possibly nested) symbol object.
function extractName(p: unknown): string | null {
  const pos = p as { instrument?: unknown; symbol?: unknown };
  const s = (pos.instrument ?? pos.symbol) as { symbol?: unknown; description?: string } | undefined;
  const inner = (s?.symbol && typeof s.symbol === "object" ? s.symbol : s) as
    | { description?: string; name?: string }
    | undefined;
  const desc = inner?.description ?? inner?.name ?? (s as { description?: string })?.description;
  return typeof desc === "string" && desc.trim() ? desc.trim() : null;
}

// The security type code ("cs", "et", "crypto", …) lives on the (possibly nested) symbol.
function extractAssetType(p: unknown): string | null {
  const pos = p as { instrument?: unknown; symbol?: unknown };
  const s = (pos.instrument ?? pos.symbol) as { symbol?: unknown; type?: { code?: string } } | undefined;
  if (!s || typeof s !== "object") return null;
  const inner = (s.symbol && typeof s.symbol === "object" ? s.symbol : s) as {
    type?: { code?: string };
    security_type?: { code?: string };
  };
  const code = inner?.type?.code ?? inner?.security_type?.code ?? s?.type?.code;
  return typeof code === "string" ? code : null;
}

function toNum(v: unknown): number | null {
  if (typeof v === "number") return isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "" && isFinite(Number(v))) return Number(v);
  return null;
}

// Cash/total balance the broker reports on the account object (shape varies by broker).
function extractCash(a: unknown): number | null {
  const total = (a as { balance?: { total?: unknown } })?.balance?.total;
  if (total == null) return null;
  if (typeof total === "number") return total;
  const t = total as { amount?: unknown; value?: unknown };
  return toNum(t.amount ?? t.value ?? total);
}

function extractCurrency(a: unknown): string {
  const total = (a as { balance?: { total?: { currency?: unknown } } })?.balance?.total;
  const c = total?.currency;
  if (typeof c === "string" && c) return c;
  if (c && typeof c === "object") {
    const code = (c as { code?: string }).code;
    if (typeof code === "string" && code) return code;
  }
  return "USD";
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
    return accounts.map((a) => {
      const category = (a.account_category ?? "").toString().trim();
      const isCash = /deposit|loc|bank|checking|saving|cash/i.test(category);
      return {
        id: a.id,
        brokerageName: a.institution_name ?? "Brokerage",
        number: a.number ?? "",
        // Prefer the brokerage's own account type ("INDIVIDUAL", "ROTH", …); fall back to the
        // display name. Empty for brokers (like E*Trade via SnapTrade) that don't expose either.
        label: (a.raw_type || a.name || "").toString().trim(),
        category,
        accountType: (a.raw_type ?? "").toString().trim(),
        cashBalance: extractCash(a),
        currency: extractCurrency(a),
        isCash,
        raw: a,
      };
    });
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
          const assetType = extractAssetType(p);
          return {
            symbol: extractTicker(p.instrument ?? p.symbol),
            name: extractName(p),
            exchange: extractExchange(p),
            units: isFinite(units) ? units : null,
            price: isFinite(priceNum) ? priceNum : null,
            avgCost,
            currency: typeof p.currency === "string" ? p.currency : null,
            assetType,
            isCrypto: assetType ? /crypto/i.test(assetType) : false,
          };
        });
    } catch {
      // One account failing (e.g. a disabled connection) shouldn't abort syncing the others.
      return [];
    }
  },

  async getOptionActivities(accountId, since): Promise<BrokerOptionActivityResult> {
    const snap = getClient();
    if (!snap) return { legs: [], scanned: 0, optionRows: 0, error: "SnapTrade not configured" };
    // Pull the FULL history by default: without an explicit startDate SnapTrade returns only a
    // recent window, which would miss older option cycles. Look back to a fixed far-past date.
    const startDate = since ?? "2015-01-01";
    const legs: BrokerOptionLeg[] = [];
    let scanned = 0;
    let optionRows = 0;
    let shape: string | undefined;
    try {
      // Page through the account's activities; keep only the option events we track. SnapTrade
      // paginates via offset/limit and returns { data: UniversalActivity[] } per page.
      const limit = 1000;
      for (let offset = 0, page = 0; page < 20; page++, offset += limit) {
        const res = await snap.accountInformation.getAccountActivities({
          accountId, startDate, offset, limit,
        });
        const body = res.data as unknown;
        const rows = ((body as { data?: unknown[] })?.data ?? (Array.isArray(body) ? body : [])) as unknown[];
        // First page only: if nothing came back, record the response's top-level shape so we can
        // tell "SnapTrade returned empty" from "we read the wrong field".
        if (page === 0 && rows.length === 0) {
          shape = Array.isArray(body) ? "array" : body && typeof body === "object" ? Object.keys(body).slice(0, 8).join(",") : String(typeof body);
        }
        scanned += rows.length;
        for (const r of rows) {
          if (r && typeof r === "object" && (r as { option_symbol?: unknown }).option_symbol) optionRows++;
          const leg = normalizeSnaptradeActivity(r);
          if (leg) legs.push(leg);
        }
        if (rows.length < limit) break; // last page
      }
      return { legs, scanned, optionRows, shape };
    } catch (e) {
      // Surface the failure instead of masking it as "no options" — the caller reports it.
      return { legs, scanned, optionRows, error: String((e as { message?: string })?.message ?? e).slice(0, 200) };
    }
  },
};
