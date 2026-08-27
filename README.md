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
| Dashboard / performance / dividends / options / tax / cash | `app/dashboard/**` |
| Server actions (add, import, refresh, delete) | `app/dashboard/**/actions.ts` |
| Scheduled jobs | `app/api/cron/{sync,alerts,digest}` + `vercel.json` |
| Market data (provider port: yahoo ⇄ eodhd) | `lib/marketdata/` |
| Broker sync (SnapTrade, owner-only) | `lib/brokersync/` |
| Options / wheel / tax / FX / email engines | `lib/` |
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
nightly sync overwrites the same rows production reads. Flip `MARKET_DATA_PROVIDER=eodhd` only
after the dry run is clean (and note that the options cockpit, wheel, and put finder go dark on
EODHD — see the matrix above).

---

*Built with Claude Code. Product strategy, roadmap, and audit docs: see `CLAUDE.md` and `docs/`.*
