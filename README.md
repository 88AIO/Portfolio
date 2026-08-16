# Snowfolio

A Snowball-Analytics-style portfolio & dividend tracker. This is **Phase 0 + 1**: sign-up/login, a real database, manual holdings entry, live prices, portfolio value, P/L, and an allocation chart. Built to grow into the full feature set (see Roadmap).

**Stack:** Next.js 16 (App Router) · TypeScript · Supabase (Postgres + Auth) · Tailwind CSS · Recharts · EODHD market data. Deploys on Vercel.

---

## What you'll need (all have free tiers)

1. **Supabase** account — the database + login system → https://supabase.com
2. **Vercel** account — hosting → https://vercel.com
3. **EODHD** API token — prices/dividends for US + Asian markets → https://eodhd.com
   *(Optional to start — the app runs without it; prices just show "—".)*
4. **Node.js 18+** installed if you want to run it on your own computer first.

---

## Setup — step by step

### 1. Create the Supabase project
- New project → pick a name + database password (save it).
- When it's ready, go to **Project Settings → API** and copy: the **Project URL**, the **anon public** key, and the **service_role** key.
- Go to **SQL Editor → New query**, paste the entire contents of `supabase/schema.sql`, and click **Run**. This creates all the tables.
- (For quick testing) **Authentication → Providers → Email** → turn **"Confirm email" OFF** so you can log in immediately without clicking a confirmation link.

### 2. Add your keys
- Copy `.env.local.example` to a new file named `.env.local`.
- Paste in the three Supabase values and (optionally) your EODHD token.

### 3. Run it locally
```bash
npm install
npm run dev
```
Open http://localhost:3000 → sign up → you're in the dashboard. Add a holding (e.g. `AAPL` / `US`, 10 shares, price 150).

### 4. Deploy to Vercel
- Push this folder to a GitHub repo (or drag-and-drop import).
- In Vercel → **New Project** → import the repo.
- Under **Environment Variables**, add the same four keys from your `.env.local`.
- Deploy. Done — you have a live URL.

---

## How it's built (quick map)

| Piece | Where |
|---|---|
| Database schema + security rules | `supabase/schema.sql` |
| Login / signup page | `app/login/page.tsx` |
| Auth session handling | `proxy.ts` (Next 16's middleware) |
| Dashboard (value, P/L, table, chart) | `app/dashboard/page.tsx` |
| Add / refresh actions | `app/dashboard/actions.ts` |
| Market data (provider port) | `lib/marketdata/` (Yahoo free default → EODHD) |
| Supabase clients | `lib/supabase/*` |

**Data model:** you record **transactions** (buy/sell/dividend); current **positions** are calculated from them automatically (a database view). Prices are cached per instrument and refreshed on demand.

---

## Roadmap (what's next)

- **Phase 2 — Dividends:** pull dividend history from EODHD, build the calendar, forecast annual income, add a dividend-safety rating.
- **Phase 3 — Analytics:** time-weighted returns, benchmark vs. S&P 500 / indices, diversification by sector & country, "why is it moving."
- **Phase 4 — Polish:** CSV/broker-statement import, real multi-currency FX conversion, watchlists, email/push alerts, Stripe billing tiers.
- **Phase 5 — Broker linking + mobile:** SnapTrade auto-sync, PWA / native apps.

---

*Built with Claude. This is a starting foundation — not affiliated with Snowball Analytics.*
