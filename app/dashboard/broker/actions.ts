"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { searchInstrument } from "@/lib/marketdata";
import { getBrokerProvider } from "@/lib/brokersync";
import type { BrokerAccount } from "@/lib/brokersync";
import { transactionDedupeKey } from "@/lib/import/csv";

type BrokerSyncResult = {
  ok: boolean;
  message?: string;
  accounts?: number;
  imported?: number;
  duplicates?: number;
};

function todayIso(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

// SnapTrade activity types we import; cash movements (no instrument) are skipped in v1.
function mapActivityType(t: string): "buy" | "sell" | "dividend" | null {
  switch (t) {
    case "BUY":
      return "buy";
    case "SELL":
      return "sell";
    case "DIVIDEND":
      return "dividend";
    default:
      return null;
  }
}

async function resolveInstrument(
  admin: ReturnType<typeof createAdminClient>,
  symbol: string,
  exchange: string
): Promise<{ id: string; currency: string } | null> {
  const { data: existing } = await admin
    .from("instruments").select("id, currency").eq("symbol", symbol).eq("exchange", exchange).maybeSingle();
  if (existing) return existing as { id: string; currency: string };
  const meta = await searchInstrument(symbol, exchange);
  const { data: created } = await admin.from("instruments").insert({
    symbol, exchange, name: meta?.name ?? symbol,
    currency: meta?.currency ?? "USD", type: meta?.type ?? "stock",
  }).select("id, currency").single();
  return (created as { id: string; currency: string } | null) ?? null;
}

// Each brokerage account maps to its own Snowfolio portfolio.
async function ensureBrokerPortfolio(
  supabase: Awaited<ReturnType<typeof createClient>>,
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
  account: BrokerAccount
): Promise<string | null> {
  const { data: existing } = await admin
    .from("broker_accounts").select("portfolio_id")
    .eq("user_id", userId).eq("provider", "snaptrade").eq("provider_account_id", account.id).maybeSingle();
  if (existing?.portfolio_id) return existing.portfolio_id as string;

  const { data: pf } = await supabase.from("portfolios").insert({
    user_id: userId, name: account.brokerageName || "Brokerage",
    broker: account.brokerageName, sync_provider: "snaptrade", is_auto_sync_enabled: true,
  }).select("id").single();
  const portfolioId = (pf as { id: string } | null)?.id ?? null;
  if (!portfolioId) return null;

  await admin.from("broker_accounts").upsert(
    {
      user_id: userId, provider: "snaptrade", provider_account_id: account.id,
      brokerage_name: account.brokerageName, account_number: account.number, portfolio_id: portfolioId,
    },
    { onConflict: "user_id,provider,provider_account_id" }
  );
  return portfolioId;
}

// Start (or reconnect) a SnapTrade connection — returns the portal URL for the client to open.
export async function startBrokerConnection(): Promise<{ url: string | null; error?: string }> {
  const provider = getBrokerProvider();
  if (!provider.isConfigured()) return { url: null, error: "Broker sync isn't configured on the server yet." };

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { url: null, error: "Not signed in." };

  const admin = createAdminClient();
  let { data: conn } = await admin
    .from("broker_connections").select("provider_user_id, provider_user_secret")
    .eq("user_id", user.id).eq("provider", "snaptrade").maybeSingle();

  if (!conn) {
    const reg = await provider.registerUser(user.id);
    const { data: created } = await admin.from("broker_connections").insert({
      user_id: user.id, provider: "snaptrade",
      provider_user_id: reg.userId, provider_user_secret: reg.userSecret,
    }).select("provider_user_id, provider_user_secret").single();
    conn = created;
  }
  if (!conn) return { url: null, error: "Couldn't register with SnapTrade." };

  const h = await headers();
  const host = h.get("host");
  const proto = h.get("x-forwarded-proto") ?? "https";
  const redirectUri = host ? `${proto}://${host}/dashboard/broker` : undefined;

  const url = await provider.getConnectPortalUrl(conn.provider_user_id, conn.provider_user_secret, redirectUri);
  return { url };
}

// Pull activity from every connected brokerage account into transactions (idempotent via activity id).
export async function syncBrokerAccounts(): Promise<BrokerSyncResult> {
  const provider = getBrokerProvider();
  if (!provider.isConfigured()) return { ok: false, message: "Broker sync isn't configured." };

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Not signed in." };

  const admin = createAdminClient();
  const { data: conn } = await admin
    .from("broker_connections").select("provider_user_id, provider_user_secret")
    .eq("user_id", user.id).eq("provider", "snaptrade").maybeSingle();
  if (!conn) return { ok: false, message: "No brokerage connected yet." };

  const accounts = await provider.listAccounts(conn.provider_user_id, conn.provider_user_secret);
  const today = todayIso();
  const instBySymbol = new Map<string, { id: string; currency: string }>();
  let imported = 0;
  let duplicates = 0;

  for (const account of accounts) {
    const portfolioId = await ensureBrokerPortfolio(supabase, admin, user.id, account);
    if (!portfolioId) continue;

    const activities = await provider.getActivities(conn.provider_user_id, conn.provider_user_secret, account.id);
    const rows: {
      portfolio_id: string; instrument_id: string; type: string;
      quantity: number; price: number; fees: number; currency: string;
      executed_at: string; dedupe_key: string;
    }[] = [];

    for (const act of activities) {
      const type = mapActivityType(act.type);
      if (!type || !act.symbol || !act.id) continue;

      const symbol = act.symbol.toUpperCase();
      let inst = instBySymbol.get(symbol);
      if (!inst) {
        const resolved = await resolveInstrument(admin, symbol, "US");
        if (!resolved) continue;
        inst = resolved;
        instBySymbol.set(symbol, inst);
      }

      let quantity = act.units ?? 0;
      let price = act.price ?? 0;
      // Dividends often arrive as a total amount rather than units × price.
      if (type === "dividend" && (quantity <= 0 || price <= 0)) {
        quantity = 1;
        price = act.amount ?? 0;
      }
      if (quantity <= 0) continue;

      const executed_at = act.tradeDate || today;
      rows.push({
        portfolio_id: portfolioId, instrument_id: inst.id, type,
        quantity, price, fees: 0,
        currency: act.currency || inst.currency || "USD",
        executed_at,
        dedupe_key: transactionDedupeKey({
          ref: `snaptrade:${act.id}`, type, instrument_id: inst.id, executed_at, quantity, price, fees: 0,
        }),
      });
    }

    if (rows.length) {
      const { data: inserted } = await supabase
        .from("transactions")
        .upsert(rows, { onConflict: "portfolio_id,dedupe_key", ignoreDuplicates: true })
        .select("id");
      const n = inserted?.length ?? 0;
      imported += n;
      duplicates += rows.length - n;
    }

    await admin.from("broker_accounts")
      .update({ last_synced_at: new Date().toISOString() })
      .eq("user_id", user.id).eq("provider", "snaptrade").eq("provider_account_id", account.id);
  }

  revalidatePath("/dashboard");
  revalidatePath("/dashboard/broker");
  return { ok: true, accounts: accounts.length, imported, duplicates };
}
