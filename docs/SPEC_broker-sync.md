# Spec — Snowfolio Broker Sync (SnapTrade)

*Feature PRD for Claude Code. Stack: Next.js 16 · TypeScript · Supabase · SnapTrade. Scope-locked: read-only sync (no trading), US-first, **credentials never touch Snowfolio**. Builds on the existing `transactions → positions` model + the idempotent `dedupe_key`. Roadmap: this is the LATER "broker auto-sync" phase.*

## Problem statement
Manual entry + CSV import get holdings in, but the calm, no-duplicates promise is best served by **live sync**: connect a brokerage once, and trades/dividends flow in automatically. The owner holds accounts across **E*TRADE, IBKR, Robinhood**; they want one honest picture without re-exporting CSVs.

## Why SnapTrade
- **Purpose-built** for retail brokerage connectivity (positions + activity), near-real-time.
- **Cheapest fit:** free Starter tier = up to 5 connected accounts; billing is **per connected user** (one user with many brokerages = one unit), then $1–2/user/mo only when *other* users connect. For the owner's own accounts it's **$0**.
- **Safe:** the user authenticates **inside SnapTrade's portal** — the brokerage password never reaches Snowfolio or the model.

## Non-goals (v1)
- **Trading / order routing** — read-only. (SnapTrade supports trading; we deliberately don't.)
- **Real-time streaming** — sync on connect + on demand ("Sync now") + optional cron. Daily is fine.
- **Non-US brokers** — US-first (matches the app's stance).
- **Historical backfill beyond what SnapTrade returns** — we take what the API gives.

> **Implemented in PERSONAL-API-KEY mode (B1):** the owner's SnapTrade key is a *Personal* key, so there is **no `registerUser`, no `userSecret`, and no connection portal**. The owner connects brokerages in the SnapTrade dashboard; Snowfolio uses `SnaptradeAuth.personalApiKey` and simply lists accounts + pulls activities. The multi-user commercial flow below is the future path if Snowfolio serves other users' brokerage connections.

## How it works (flow)
1. Owner creates a **free SnapTrade developer account** → `clientId` + `consumerKey` (server-only secrets → Vercel env: `SNAPTRADE_CLIENT_ID`, `SNAPTRADE_CONSUMER_KEY`).
2. Per Snowfolio user: **register** with SnapTrade → store the returned `userSecret` (server-side, service-role only).
3. **Connect:** generate a SnapTrade **connection-portal URL** → redirect the user there → they log into their broker in SnapTrade's portal → SnapTrade redirects back to `/dashboard/broker`.
4. **Sync:** list connected accounts; for each, pull **activities** (buys/sells/dividends) and map them into `transactions` — **idempotent** via `dedupe_key = ref:snaptrade:<activityId>` (re-sync never double-counts). Positions/dividends/total-return then compute automatically.

## Data model (extends `supabase/schema.sql`)
```
broker_connections                       -- one SnapTrade registration per Snowfolio user
  id, user_id -> auth.users, provider ('snaptrade'),
  provider_user_id, provider_user_secret,  -- SECRET: RLS on, NO client policies (service-role only)
  created_at
  unique (user_id, provider)

broker_accounts                          -- each connected brokerage account -> a Snowfolio portfolio
  id, user_id -> auth.users, provider,
  provider_account_id, brokerage_name, account_number,
  portfolio_id -> portfolios,
  last_synced_at, created_at
  unique (user_id, provider, provider_account_id)
```
- Each SnapTrade account maps to its **own Snowfolio portfolio** (named after the brokerage), tagged `sync_provider='snaptrade'` — the `portfolios` table already carries `is_auto_sync_enabled` / `sync_provider` / `setup_required` from the blueprint.
- `provider_user_secret` is a secret → `broker_connections` has RLS enabled with **no client policies**; only the service-role (admin) client reads/writes it, so it never reaches the browser.

## Market-data / provider port (`lib/brokersync/`)
Mirrors the `lib/marketdata` port so a different aggregator (Plaid, per-broker APIs) can be swapped later.
```ts
interface BrokerSyncProvider {
  readonly name: string;
  isConfigured(): boolean;
  registerUser(userId): Promise<{ userId: string; userSecret: string }>;
  getConnectPortalUrl(userId, userSecret, redirectUri?): Promise<string | null>;
  listAccounts(userId, userSecret): Promise<BrokerAccount[]>;      // { id, brokerageName, number }
  getActivities(userId, userSecret, accountId, since?): Promise<BrokerActivity[]>; // { id, type, symbol, units, price, amount, currency, tradeDate }
}
```
SnapTrade provider uses the official `snaptrade-typescript-sdk` (`new Snaptrade({ clientId, consumerKey })`): `authentication.registerSnapTradeUser`, `authentication.loginSnapTradeUser` (→ `redirectURI`), `accountInformation.listUserAccounts`, `accountInformation.getAccountActivities`.

## Server actions (`app/dashboard/broker/actions.ts`)
- `startBrokerConnection()` → ensure the user is registered (store `userSecret` via admin), return a portal URL (client redirects to it).
- `syncBrokerAccounts()` → list accounts → for each: ensure a portfolio + `broker_accounts` row → pull activities → map to `transactions` (upsert, `ignoreDuplicates`, `dedupe_key = ref:snaptrade:<id>`) → resolve/create instruments → `last_synced_at = now`. Reuses `syncInstrumentDividends` + the existing dedup/positions engine.

**Activity → transaction mapping:** `type` BUY→buy, SELL→sell, DIVIDEND→dividend, CONTRIBUTION/DEPOSIT→deposit, WITHDRAWAL→withdrawal; unknown types skipped (never guessed). `units`→quantity, `price`→price, `trade_date`→executed_at, `currency.code`→currency, `symbol.symbol`→instrument.

## UI (`/dashboard/broker`, linked from the header)
- **Not configured** (no SnapTrade keys): a calm "Broker sync isn't set up yet" note.
- **Configured:** "Connect a brokerage" button (→ portal), a list of connected accounts (brokerage · masked number · last synced), and "Sync now".
- Copy stays honest: read-only, "credentials handled by your broker", "prices/positions as of…".

## Acceptance criteria (v1)
- [ ] With `SNAPTRADE_*` env set, "Connect a brokerage" opens SnapTrade's portal; after connecting, the account appears under `/dashboard/broker`.
- [ ] "Sync now" imports that account's activity as transactions; the dashboard reflects the positions.
- [ ] Re-syncing imports **zero duplicates** (dedup on SnapTrade activity id).
- [ ] Each brokerage lands in its **own portfolio**; multi-broker totals convert via the existing FX layer.
- [ ] No brokerage credential is ever stored or seen by Snowfolio; `provider_user_secret` is never exposed to the browser.
- [ ] With no `SNAPTRADE_*` keys, the app runs normally and the broker screen shows the "not set up" state.

## Phasing
- **B1 (this build):** schema, `lib/brokersync` port + SnapTrade provider, connect + sync actions, `/dashboard/broker` UI. Compile-verified; runtime-validated once the owner adds SnapTrade keys + connects a real account (activity-mapping field names confirmed against live data).
- **B2:** scheduled auto-sync (cron), reconnect/disconnect handling, SnapTrade webhooks, per-account balances/cash.

## Setup (owner)
Create a free SnapTrade developer account → copy `clientId` + `consumerKey` → add as `SNAPTRADE_CLIENT_ID` / `SNAPTRADE_CONSUMER_KEY` in Vercel env (and `.env.local` for local). Nothing else to share — brokerage logins stay with the broker.

*Cross-refs: `CLAUDE.md` (roadmap LATER), `docs/API_BLUEPRINT.md` (portfolios sync fields), `lib/marketdata` (port pattern reused).*
