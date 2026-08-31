# Snowfolio

A calm portfolio tracker for **performance + income** — dividends *and* option premium — built for options sellers (covered calls, cash-secured puts, the wheel). Web-only (installable PWA), US-first with international support. Not affiliated with Snowball Analytics.

**Stack:** Next.js 16 (App Router) · TypeScript · Supabase (Postgres + Auth) · Tailwind CSS · Recharts · market data behind the `lib/marketdata` provider port (**Yahoo free default**, EODHD as the paid switch). Deploys on Vercel.

Strategy, specs, and audits live in `docs/` (see the index in `CLAUDE.md`).

---

## What you'll need (all have free tiers)

1. **Supabase** account — the database + login system → https://supabase.com
2. **Vercel** account — hosting + the nightly cron → https://vercel.com
3. **Node.js 18+** if you want to run it locally first.
4. Optional: **Resend** (notification emails), **SnapTrade** (owner-only broker sync), **EODHD** (paid market data — the app defaults to free Yahoo and needs no key).

---

## Setup — step by step

### 1. Create the Supabase project
- New project → pick a name + database password (save it).
- When it's ready, go to **Project Settings → API** and copy: the **Project URL**, the **anon public** key, and the **service_role** key.
- Go to **SQL Editor → New query**, paste the entire contents of `supabase/schema.sql`, and click **Run**. This creates all tables, views, and RLS policies.

### 2. Add your keys
- Copy `.env.local.example` to a new file named `.env.local` and fill it in. **`.env.local.example` is the canonical list of every environment variable** — each entry documents what it does and whether it's required. The short version:
  - `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` — required.
  - `CRON_SECRET` — required in production: **without it every scheduled job refuses to run** (fails closed), so prices/dividends never refresh.
  - `RESEND_API_KEY` + `EMAIL_FROM` — required for alert/digest emails to send at all.
  - `MARKET_DATA_PROVIDER` (default `yahoo`, no key needed) / `EODHD_API_TOKEN` (only for `eodhd`).
  - `SNAPTRADE_CLIENT_ID` / `SNAPTRADE_CONSUMER_KEY` / `BROKER_SYNC_OWNER_EMAILS` — owner-only broker sync; leave unset to hide the feature.
  - `NEXT_PUBLIC_SITE_URL` — set once a custom domain is live.

### 3. Run it locally
```bash
npm install
npm run dev
```
Open http://localhost:3000 → sign up → you're in the dashboard. Add a holding (e.g. `AAPL` / `US`), import a CSV, or connect a broker (owner only).

```bash
npm test        # offline unit tests (money math)
npm run test:rls # cross-tenant RLS isolation test (needs Supabase env vars; skips cleanly without)
```

### 4. Deploy to Vercel
- Push to GitHub → Vercel **New Project** → import the repo.
- Under **Environment Variables**, add everything you set in `.env.local` (at minimum the three Supabase keys **and `CRON_SECRET`**).
- Deploy. `vercel.json` registers the three scheduled jobs (nightly market-data sync, daily alerts, weekly digest) automatically.

---

## How it's built (quick map)

| Piece | Where |
|---|---|
| Database schema + RLS + views | `supabase/schema.sql` |
| Auth session handling | `proxy.ts` (Next 16's middleware) |
| Dashboard / performance / dividends / options / cash | `app/dashboard/**` |
| Server actions (add, import, refresh, delete) | `app/dashboard/**/actions.ts` |
| Scheduled jobs | `app/api/cron/{sync,alerts,digest}` + `vercel.json` |
| Market data (provider port: yahoo ⇄ eodhd) | `lib/marketdata/` |
| Broker sync (SnapTrade, owner-only) | `lib/brokersync/` |
| Options / wheel / realized-gain / dividend / FX / email engines | `lib/` |
| Tests | `tests/` |

**Data model:** you record **transactions** (equity, options, cash); current **positions** and option exposure are computed views over that ledger. Pages read cached tables (`price_cache`, `fx_rates`, `price_history`, `dividends`); only the nightly cron talks to the market-data vendor.

### Market-data provider coverage

Both providers implement the same port (`lib/marketdata/`), so switching is one env var — but they
are not identical. What each covers today:

| Port method | Yahoo (default, free) | EODHD (`MARKET_DATA_PROVIDER=eodhd`) |
|---|---|---|
| Quotes · FX · instrument search | ✅ | ✅ |
| Price history (weekly closes) | ✅ | ✅ |
| Dividend history · dividend info | ✅ | ✅ |
| Company profile (sector/country) | ✅ | ✅ |
| ETF/fund sector breakdown | ✅ | ✅ |
| **Option chains** | ✅ | ❌ **separate paid add-on** |

Everything the nightly sync needs works on either provider. The one gap is options: EODHD sells US
options through a marketplace add-on (Unicorn Data Services, `/mp/unicornbay/options/*`) that is
not included in any base plan. `capabilities.options` is therefore `false` for EODHD, so the port
degrades honestly rather than returning empty option boards — the options cockpit, wheel, and put
finder stay Yahoo-only until that add-on is subscribed and `getOptionChain` is implemented against
a real payload.

**Licensing note:** Yahoo is an unofficial, non-commercial feed. It is fine for personal and
development use; a paid product should move to a licensed provider. That is what the EODHD path
exists for.

### Before switching to EODHD

```bash
EODHD_API_TOKEN=your-token npm run verify:eodhd
# or pick your own tickers:
EODHD_API_TOKEN=your-token npm run verify:eodhd -- AAPL:US SCHD:US ULVR:LSE
```

`scripts/verify-eodhd.mjs` calls **both** providers for the same tickers and diffs them — prices,
currency, weekly history, dividend rate/yield/history, sector labels, fund weights, FX — and exits
non-zero if anything looks wrong. It **reads only; it writes nothing to Supabase.** It is looking
for the two ways this provider can be confidently wrong: the minor-unit ÷100 (EODHD's price
endpoints return no currency, so the provider infers it from the exchange code — a wrong guess
makes every LSE price 100× off) and the dividend-yield scale (fraction vs. percent).

Run this rather than pointing a preview deployment at EODHD. `price_cache`, `price_history`,
`dividends`, and `instruments` are **shared reference tables written with the service-role key and
are not scoped per environment** — with a single Supabase project, a preview deploy running the
nightly sync overwrites the same rows production reads.

### The cutover

Only after `npm run verify:eodhd` exits 0.

1. **Check the call budget against your plan.** Steady state, the nightly sync makes **4 provider
   requests per distinct instrument**: quote, dividend info (`/fundamentals`), dividend history,
   price history — plus one FX call per distinct currency, and a one-off `/search` for any
   instrument still showing a bare ticker as its name. The `/fundamentals` one is the expensive
   one: EODHD bills it at a multiple of a normal call. Multiply by your instrument count and
   confirm it fits your plan's daily allowance before the first night, not after.
2. **Set both variables in Vercel → Settings → Environment Variables, Production:**
   `EODHD_API_TOKEN` = your token, and `MARKET_DATA_PROVIDER` = `eodhd`.
3. **Redeploy.** Env vars are read at runtime, but a redeploy is the clean way to be sure every
   running function picks them up.
4. **Trigger one sync and read the result** — `sync_runs` records `duration_ms`, `providerCalls`,
   and `failed_symbols` for the run. `failed_symbols` should be empty or near it; `providerCalls`
   should land near your step-1 estimate. A big gap either way means stop.
5. **Spot-check the data it wrote**: one US name and one LSE name in `price_cache`, against a
   public quote. This is the last place a wrong ÷100 can still be caught.

**Rollback** is one variable: set `MARKET_DATA_PROVIDER` back to `yahoo` and redeploy. The next
nightly sync overwrites whatever EODHD wrote, since every table it touches is an upsert keyed by
instrument. Nothing is migrated or destroyed by the switch, so there is no restore step.

**What changes for users:** the options cockpit and wheel keep working — they're computed from the
user's own recorded transactions, not from chains. The **put finder** and **IV rank** go dark,
because EODHD sells option chains only as a separate add-on. The finder says so plainly instead of
reporting an empty scan (`optionsUnavailable` on `FinderResult`), and the nightly IV sample is
skipped rather than failing once per symbol.

### International holdings: which provider is safer

Yahoo returns a **currency with every quote**, so the minor-unit divisor is read from the data
(`normalizeCurrency(q.currency)`) and is correct for any exchange, including ones nobody
enumerated. EODHD's price endpoints return **no currency**, so the divisor has to be inferred.

The inference rule is: the **exchange** says which currency is quoted in a minor unit (London
pence, Johannesburg cents, Tel Aviv agorot); the **instrument's own stored currency** says whether
this particular listing is that currency. London matters here because it lists USD- and
EUR-denominated lines alongside its pence ones — an exchange-only rule divided those by 100 too,
producing a plausible number that nothing downstream would reject. Callers pass the stored currency
into `getQuote`/`getPriceHistory`; `tests/minor-unit.test.mjs` pins every case.

The minor-unit list is deliberately three entries. Hong Kong, Tokyo, Sydney, Toronto, Singapore and
Mumbai all quote in major units — **adding exchanges to that map manufactures 100× errors rather
than preventing them.** Extend it only for an exchange whose quotes are genuinely in a minor unit.

Net: for an international portfolio Yahoo is the structurally safer feed, and it is the only one
with option chains. EODHD's advantage is **licensing**, which is what matters once the product
charges money.

---

*Built with Claude Code. Product strategy, roadmap, and audit docs: see `CLAUDE.md` and `docs/`.*
