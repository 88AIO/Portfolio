// SnapTrade provider — read-only brokerage sync via the official snaptrade-typescript-sdk.
// Uses a PERSONAL API key: the key represents one account, so there's no registerUser / userSecret
// and no connection portal. Reads current positions (the /positions endpoint — the deprecated
// /holdings endpoint returns 410 Gone for accounts created after May 2026). See docs/SPEC_broker-sync.md.
import { Snaptrade, SnaptradeAuth } from "snaptrade-typescript-sdk";
import type { BrokerAccount, BrokerPosition, BrokerSyncProvider, BrokerOptionLeg, BrokerEquityTxn, BrokerActivitiesResult, BrokerOptionPositionResult } from "../types";
import { normalizeSnaptradeActivity, normalizeSnaptradeOptionPosition, isOptionPosition } from "../options";

// Map a SnapTrade equity/dividend activity onto a real dated transaction, or null to skip. Reuses
// the SAME ticker/exchange extractors as positions, so the resulting instrument matches the holding
// snapshot (critical for share reconciliation). Only BUY / SELL / DIVIDEND are taken; cash movements,
// transfers, fees and interest are left out (a transfer-in is handled later by share reconciliation).
export function normalizeEquityActivity(raw: unknown): BrokerEquityTxn | null {
  if (!raw || typeof raw !== "object") return null;
  const a = raw as Record<string, unknown>;
  if (a.option_symbol) return null; // options handled elsewhere
  const t = String(a.type ?? "").toUpperCase().replace(/[\s_]/g, "");
  const txnType = t === "BUY" ? "buy" : t === "SELL" ? "sell" : t === "DIVIDEND" ? "dividend" : null;
  if (!txnType) return null;

  const symObj = a.symbol;
  const symbol = (extractTicker(symObj) ?? "").toUpperCase();
  if (!symbol) return null;
  const exchange = extractExchange({ symbol: symObj });
  const name = extractName({ symbol: symObj });

  const units = toNum(a.units);
  const price = toNum(a.price);
  const amount = toNum(a.amount);
  const fee = Math.abs(toNum(a.fee) ?? 0);
  const currency = extractActivityCurrency(a.currency);
  const tradeDate = String(a.trade_date ?? a.settlement_date ?? "").slice(0, 10);
  if (!tradeDate) return null;
  const ref = String(a.id ?? a.external_reference_id ?? `${symbol}:${txnType}:${tradeDate}:${units ?? amount ?? ""}`);

  if (txnType === "dividend") {
    const cash = amount ?? 0;
    const units = toNum(a.units);
    const shares = units != null ? Math.abs(units) : 0;

    // A REINVESTMENT is filed under the same DIVIDEND activity type as the payment that funded it,
    // but it is the opposite thing: the cash leaving again to buy shares. E*TRADE reports it with a
    // negative amount and the units purchased, right beside the positive "Qualified Dividend" row.
    //
    // Taking Math.abs() of that amount — as this did — turned the outflow into a second helping of
    // income, so every reinvested payment was counted twice: a $100.45 dividend became $200.83, and
    // the shares it bought went unrecorded, absorbed later into the broker opening-balance lot.
    // It is a purchase, and it is a DRIP purchase.
    if (cash < 0 && shares > 0 && price != null && price > 0) {
      return { symbol, exchange, name, txnType: "buy", quantity: shares, price, fee, currency, tradeDate, ref, drip: true };
    }

    // Otherwise it really is cash income. The sign is kept rather than absolute-valued: a negative
    // amount with no shares is a reversal or clawback, and forcing it positive would book a
    // correction as extra income.
    if (cash === 0) return null;
    return { symbol, exchange, name, txnType, quantity: 1, price: cash, fee, currency, tradeDate, ref };
  }

  const qty = units != null ? Math.abs(units) : 0;
  if (qty <= 0) return null;
  // Per-share price: prefer the reported price, else back it out of the total amount.
  const perShare = price != null && price > 0 ? price : amount != null ? Math.abs(amount) / qty : 0;
  if (perShare <= 0) return null;
  return { symbol, exchange, name, txnType, quantity: qty, price: perShare, fee, currency, tradeDate, ref };
}

// Activity-level currency can be a bare code or an object { code }.
function extractActivityCurrency(c: unknown): string {
  if (typeof c === "string" && c) return c;
  if (c && typeof c === "object") {
    const o = c as { code?: string; currency?: string };
    if (typeof o.code === "string" && o.code) return o.code;
    if (typeof o.currency === "string" && o.currency) return o.currency;
  }
  return "USD";
}

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
      const txn = (a as { sync_status?: { transactions?: { initial_sync_completed?: boolean; first_transaction_date?: string | null; last_successful_sync?: string | null } } }).sync_status?.transactions;
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
        txnSync: txn
          ? { initialDone: txn.initial_sync_completed ?? null, firstDate: txn.first_transaction_date ?? null, lastSync: txn.last_successful_sync ?? null }
          : undefined,
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
        // Skip cash-equivalents and option contracts — options are handled by getOptionPositions;
        // mapping them here would create a bogus equity holding from the OCC symbol.
        .filter((p) => !p.cash_equivalent && !isOptionPosition(p))
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

  async getActivities(accountId, since): Promise<BrokerActivitiesResult> {
    const snap = getClient();
    if (!snap) return { optionLegs: [], equityTxns: [], scanned: 0, optionRows: 0, equityRows: 0, error: "SnapTrade not configured" };
    // Pull the FULL history by default: without an explicit startDate SnapTrade returns only a
    // recent window, which would miss older trades. Look back to a fixed far-past date.
    const startDate = since ?? "2015-01-01";
    const optionLegs: BrokerOptionLeg[] = [];
    const equityTxns: BrokerEquityTxn[] = [];
    let scanned = 0;
    let optionRows = 0;
    let equityRows = 0;
    let shape: string | undefined;
    try {
      // Page through the account's activities. SnapTrade paginates via offset/limit and returns
      // { data: UniversalActivity[] } per page. Each row is either an option event (option_symbol
      // set), an equity trade/dividend (symbol set, a BUY/SELL/DIVIDEND type), or cash/other.
      const limit = 1000;
      for (let offset = 0, page = 0; page < 20; page++, offset += limit) {
        const res = await snap.accountInformation.getAccountActivities({ accountId, startDate, offset, limit });
        const body = res.data as unknown;
        const rows = ((body as { data?: unknown[] })?.data ?? (Array.isArray(body) ? body : [])) as unknown[];
        if (page === 0 && rows.length === 0) {
          shape = Array.isArray(body) ? "array" : body && typeof body === "object" ? Object.keys(body).slice(0, 8).join(",") : String(typeof body);
        }
        scanned += rows.length;
        for (const r of rows) {
          if (r && typeof r === "object" && (r as { option_symbol?: unknown }).option_symbol) {
            optionRows++;
            const leg = normalizeSnaptradeActivity(r);
            if (leg) optionLegs.push(leg);
          } else {
            const tx = normalizeEquityActivity(r);
            if (tx) { equityRows++; equityTxns.push(tx); }
          }
        }
        if (rows.length < limit) break; // last page
      }
      return { optionLegs, equityTxns, scanned, optionRows, equityRows, shape };
    } catch (e) {
      return { optionLegs, equityTxns, scanned, optionRows, equityRows, error: String((e as { message?: string })?.message ?? e).slice(0, 200) };
    }
  },

  async getOptionPositions(accountId): Promise<BrokerOptionPositionResult> {
    const snap = getClient();
    if (!snap) return { legs: [], positions: 0, optionPositions: 0, error: "SnapTrade not configured" };
    const today = new Date().toISOString().slice(0, 10);
    try {
      const res = await snap.accountInformation.getAllAccountPositions({ accountId });
      const results = (res.data?.results ?? []) as unknown[];
      const legs: BrokerOptionLeg[] = [];
      let optionPositions = 0;
      let sample: string | undefined;
      for (const p of results) {
        if (!isOptionPosition(p)) continue;
        optionPositions++;
        // Capture the shape of the first option position we ever see, so the exact field mapping
        // (esp. per-share vs per-contract premium) can be verified against real data.
        if (!sample) {
          const inst = (p as { instrument?: Record<string, unknown> }).instrument ?? {};
          sample = `pos[${Object.keys(p as object).slice(0, 8).join(",")}] inst[${Object.keys(inst).slice(0, 10).join(",")}]`;
        }
        const leg = normalizeSnaptradeOptionPosition(p, today);
        if (leg) legs.push(leg);
      }
      return { legs, positions: results.length, optionPositions, sample };
    } catch (e) {
      return { legs: [], positions: 0, optionPositions: 0, error: String((e as { message?: string })?.message ?? e).slice(0, 200) };
    }
  },
};
