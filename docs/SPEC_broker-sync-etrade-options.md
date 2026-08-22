# E*TRADE options auto-sync — decision + plan

_Captured 2026-08. Question: how do we get the owner's E*TRADE options (Individual + Roth IRA)
into Snowfolio's options ledger automatically?_

## TL;DR recommendation

**Use SnapTrade, not E*TRADE's direct API.** SnapTrade already supports E*TRADE (both cash/individual
and Roth IRA show up as separate accounts), it's already wired into this repo, its account-activities
feed carries the option legs we need (sold/closed/expired/assigned), and it's free for a single
connected user — which is exactly the owner-only setup we run today. E*TRADE's own API would mean
building and maintaining an OAuth 1.0a integration behind a developer licensing agreement with a slow,
manual approval — all cost, no upside over SnapTrade for our case.

## Option A — E*TRADE direct API (rejected)

- OAuth **1.0a** (request-token → user authorize → access-token), sandbox `apisb.etrade.com` then
  production `api.etrade.com`.
- Requires accepting the **API Developer Licensing Agreement** and getting a **production consumer key**
  approved by E*TRADE (now Morgan Stanley). Approval is manual and historically slow/uncertain for
  individual developers; market-data access carries exchange-entitlement rules.
- We'd own the whole integration surface (token refresh, per-account entitlements, option-symbol
  parsing) for one brokerage. **Not worth it.**

## Option B — SnapTrade (chosen)

- One integration already covers E*TRADE + most major US brokers.
- **Coverage we need:** balances, holdings, **option positions**, and **transactions/activities**.
  Options support is real but narrower than equities — fine for us (we only read, never trade).
- **Cost:** free production tier for 1 connected user; ~$1–2/user/month beyond that. Owner-only today
  fits the free tier.
- **The key fact for options:** the seller-flow ledger we store (`option_transactions`) is a
  *transaction history*, not a snapshot. SnapTrade's `getAccountActivities` (→ `UniversalActivity`)
  reports exactly that: `type` = `OPTIONEXPIRATION` / `OPTIONASSIGNMENT`, `option_type` =
  `SELL_TO_OPEN` / `BUY_TO_CLOSE` / `BUY_TO_OPEN` / `SELL_TO_CLOSE`, plus `option_symbol`
  (underlying, put/call, strike, expiration), `units` (contracts), `price` (per share), `fee`, and a
  stable `id` for idempotency.

## What's built now (Phase 1 — plumbing, shipped)

Code is in place and no-ops safely until the owner connects E*TRADE via SnapTrade (env unset →
disabled, same safe default as the rest of broker sync):

- `lib/brokersync/options.ts` — `normalizeSnaptradeActivity()` maps one activity row to a
  seller-flow leg (`sell_to_open` / `buy_to_close` / `expired` / `assigned`) or `null`. Long-option
  activity (`BUY_TO_OPEN` / `SELL_TO_CLOSE` / `OPTIONEXERCISE`) is skipped — Snowfolio is an
  options-*selling* tracker and the DB views assume the seller's side.
- `snaptradeProvider.getOptionActivities()` — pages the activities feed and returns normalized legs.
- `syncBrokerAccounts()` — for each connected account, imports those legs into `option_transactions`
  idempotently (dedupe on SnapTrade's activity id). Snapshot semantics: prior `opt:snaptrade%` rows
  for the portfolio are cleared and re-inserted each sync.

**Deliberate limitation — no double-counted shares:** equity holdings are synced as a *position
snapshot* (a synthetic buy at cost basis), so assigned shares already appear there. We therefore do
**not** also write an equity leg for an `assigned` option activity (that would double the share
count). The assignment is recorded on the options side only; premium income counts once.

## What the owner does (Phase 2 — connect, their action)

1. Create a SnapTrade account, get `SNAPTRADE_CLIENT_ID` + `SNAPTRADE_CONSUMER_KEY` (personal API key).
2. In the SnapTrade dashboard, connect the two **E*TRADE** accounts (Individual + Roth IRA).
3. Set `SNAPTRADE_CLIENT_ID`, `SNAPTRADE_CONSUMER_KEY`, and add the owner email to
   `BROKER_SYNC_OWNER_EMAILS`; redeploy.
4. Run **Sync** on the Brokers page. Stock positions import as today; option legs now flow into the
   options ledger and light up the Wheel cycles view.

## Validate on first real trade

Everything above is written against SnapTrade's documented `UniversalActivity` shape but is untested
against a live E*TRADE options fill (the owner has none yet). On the owner's **first** real option
trade, re-check the mapping — especially `option_type` action strings and `price` vs `amount` for
premium-per-share — and adjust `normalizeSnaptradeActivity()` if E*TRADE labels differ.

## Update (Aug 2026): activities feed is empty → use the positions feed

Live QC finding: for these connections SnapTrade's **transactions/activities feed returns 0 rows**
across every account (diagnostic showed `data,pagination` with an empty `data` array — our read is
correct; the feed is genuinely empty). This is a known SnapTrade trait — many connections expose
*holdings* but not the full *transaction* history (it can require a higher data tier / brokerage
support). So the activities path, while still wired, won't populate here.

**Primary path is now the positions feed** (`getAllAccountPositions`), which demonstrably works (it
already syncs all stock holdings). Per SnapTrade's schema, an open option contract appears there as
an `AccountPosition` with `instrument.kind === "option"` (OCC symbol, `option_type`, `strike_price`,
`expiration_date`, `multiplier`, `underlying`). `getOptionPositions()` reads those and imports each
**short** position (`units < 0`) as an open `sell_to_open` leg under the `opt:snaptrade-pos:` prefix.
Long options are skipped (not seller income). A latent bug was fixed alongside: `getPositions` now
skips option rows so an OCC symbol never becomes a bogus equity holding.

**One thing to verify on the first real position:** the premium-per-share mapping. We use SnapTrade's
per-share `cost_basis` (the same convention the equity sync relies on), falling back to `price`. The
sync's per-account diagnostic prints the raw shape of the first option position it sees
(`[pos[...] inst[...]]`) so the exact field semantics (per-share vs per-contract) can be confirmed
against a live short option before the premium figure is trusted.

## Fallback if SnapTrade ever falls short

A CSV importer for E*TRADE's own options export (mirroring the existing stock CSV importer) is the
no-dependency backstop. The normalized `BrokerOptionLeg` shape is deliberately provider-agnostic, so a
CSV path can reuse the same ledger-insert logic.
