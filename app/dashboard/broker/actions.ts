"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getBrokerProvider } from "@/lib/brokersync";
import type { BrokerAccount } from "@/lib/brokersync";
import { transactionDedupeKey } from "@/lib/import/csv";

type BrokerSyncResult = {
  ok: boolean;
  message?: string;
  accounts?: number;
  holdings?: number;
};

function todayIso(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

async function resolveInstrument(
  admin: ReturnType<typeof createAdminClient>,
  symbol: string,
  exchange: string,
  currency: string
): Promise<{ id: string; currency: string } | null> {
  const { data: existing } = await admin
    .from("instruments").select("id, currency").eq("symbol", symbol).eq("exchange", exchange).maybeSingle();
  if (existing) return existing as { id: string; currency: string };
  // Create cheaply (name = symbol, no provider lookup) to keep sync fast; the dashboard's
  // "Refresh prices" enriches names/dividends later.
  const { data: created } = await admin.from("instruments").insert({
    symbol, exchange, name: symbol, currency: currency || "USD", type: "stock",
  }).select("id, currency").single();
  return (created as { id: string; currency: string } | null) ?? null;
}

// Each brokerage account maps to its own Snowfolio portfolio (named with the masked account #).
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

  const last4 = account.number ? account.number.slice(-4) : "";
  const name = last4 ? `${account.brokerageName} ••••${last4}` : account.brokerageName || "Brokerage";

  const { data: pf } = await supabase.from("portfolios").insert({
    user_id: userId, name,
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

// Pull the CURRENT positions from every connected brokerage account and mirror them into Snowfolio.
// Each sync replaces this account's synced snapshot, so holdings always match the broker exactly.
export async function syncBrokerAccounts(): Promise<BrokerSyncResult> {
  const provider = getBrokerProvider();
  if (!provider.isConfigured()) return { ok: false, message: "Broker sync isn't configured." };

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Not signed in." };

  const admin = createAdminClient();
  const accounts = await provider.listAccounts();
  // Temporary diagnostic: which accounts came back (remove after debugging coverage).
  console.log(
    `[broker-sync] ${accounts.length} account(s):`,
    accounts.map((a) => `${a.brokerageName}/${a.number}`).join(" | ")
  );
  const today = todayIso();
  const now = new Date().toISOString();
  const instBySymbol = new Map<string, { id: string; currency: string }>();
  let holdings = 0;

  for (const account of accounts) {
    const portfolioId = await ensureBrokerPortfolio(supabase, admin, user.id, account);
    if (!portfolioId) continue;

    const positions = await provider.getPositions(account.id);
    // Temporary diagnostic: what positions came back per account (symbols + units only).
    console.log(
      `[broker-sync] ${account.brokerageName}/${account.number}: ${positions.length} position(s):`,
      positions.map((p) => `${p.symbol ?? "NULL"}=${p.units ?? "?"}@${p.avgCost ?? "?"}`).join(", ")
    );

    // Clear ALL prior SnapTrade-sourced rows in this account's portfolio (old activity-based
    // rows + the previous position snapshot) so nothing stale or double-counted lingers.
    await supabase
      .from("transactions")
      .delete()
      .eq("portfolio_id", portfolioId)
      .like("dedupe_key", "ref:snaptrade%");

    const rows: {
      portfolio_id: string; instrument_id: string; type: string;
      quantity: number; price: number; fees: number; currency: string;
      executed_at: string; dedupe_key: string;
    }[] = [];

    for (const pos of positions) {
      if (!pos.symbol || !pos.units || pos.units <= 0) continue;
      const symbol = pos.symbol.toUpperCase();

      let inst = instBySymbol.get(symbol);
      if (!inst) {
        const resolved = await resolveInstrument(admin, symbol, "US", pos.currency ?? "USD");
        if (!resolved) continue;
        inst = resolved;
        instBySymbol.set(symbol, inst);
      }

      const currency = pos.currency || inst.currency || "USD";
      // Synthetic opening buy at the per-share cost basis (falls back to price if cost is missing).
      const price = pos.avgCost ?? pos.price ?? 0;
      rows.push({
        portfolio_id: portfolioId, instrument_id: inst.id, type: "buy",
        quantity: pos.units, price, fees: 0, currency, executed_at: today,
        dedupe_key: transactionDedupeKey({
          ref: `snaptrade-pos:${account.id}:${symbol}`, type: "buy",
          instrument_id: inst.id, executed_at: today, quantity: pos.units, price, fees: 0,
        }),
      });

      // Cache the broker's last price so market value shows immediately (before any price refresh).
      if (pos.price != null) {
        await admin.from("price_cache").upsert({
          instrument_id: inst.id, price: pos.price, currency, as_of: now,
        });
      }
    }

    if (rows.length) await supabase.from("transactions").insert(rows);
    holdings += rows.length;

    await admin.from("broker_accounts")
      .update({ last_synced_at: now })
      .eq("user_id", user.id).eq("provider", "snaptrade").eq("provider_account_id", account.id);
  }

  revalidatePath("/dashboard");
  revalidatePath("/dashboard/broker");
  return { ok: true, accounts: accounts.length, holdings };
}
