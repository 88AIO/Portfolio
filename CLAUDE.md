# Snowfolio — Project Brief (for Claude Code)

You are continuing an existing build. Read this file and `docs/API_BLUEPRINT.md` before writing code.
Note: this repo uses **Next.js 16** (App Router, Turbopack) — some APIs differ from older Next; `cookies()` is async, and middleware lives in `proxy.ts` (not `middleware.ts`).

## What we're building
A 1:1 replica of **Snowball Analytics** (an investment portfolio + dividend tracker), then improved on its known weaknesses. Owner is a solo builder (US + Asian markets focus, faceless personal-finance creator) who does not code — write the code, run it, and explain steps plainly.

## Target model (source of truth)
`docs/API_BLUEPRINT.md` is the reverse-engineered spec of the real Snowball API and data model, captured from a live authenticated session. Build to match it:
- Snowball's real backend is REST at `/extapi/api/` (ASP.NET/C#). Ours mirrors the same resources as Next.js route handlers under `app/api/`.
- **Portfolio** = 38-field config (goals, tax rules, composite "pie" portfolios, broker sync, sharing, categories).
- **Holding/Position** = ~117 fields, almost all **computed** at query time from raw transactions + instrument reference + dividend history. Do NOT store computed fields — compute them.
- Standard **paginated envelope**: `{ data:[…], totalCount, page, pageSize, sortBy, sortDirection }`.
- Every list/aggregate endpoint takes a `currency=` param and converts server-side.

## Stack (already chosen)
Next.js 16 (App Router) · TypeScript · Supabase (Postgres + Auth) · Tailwind · Recharts · EODHD (market data + FX). Deploy on Vercel. One language end-to-end.

## What already exists (current state)
- Auth (email/password + OAuth-ready), session handling in `proxy.ts`.
- `supabase/schema.sql` — v2, modeled on the blueprint: `profiles, portfolios (full config), categories, instruments (reference+fundamentals+div), transactions, price_cache, dividends`, plus `positions` and `portfolio_totals` views that compute Snowball-style fields.
- Dashboard: summary cards (market value, cost, P/L, day P/L, est. annual dividends + yield), holdings table with per-holding yield, allocation donut. Multi-currency totals via server FX.
- `lib/marketdata.ts` — EODHD quotes, FX, instrument search. `app/dashboard/actions.ts` — add transaction, refresh prices.
- Verified: `npm run build`, `tsc`, and `eslint` all pass.

## Roadmap (build in this order — each phase must stay runnable)
1. **Holdings API + full holdings screen** to parity: `app/api/holdings` with pagination, `sortBy/sortDirection`, `filter`, `showSoldHoldings`, `currency`; `holdings/totals`; portfolio switcher; per-holding detail. Expand the `positions` view toward the full 117-field set (XIRR, period gains, bond fields).
2. **Dividend engine**: pull dividend history + upcoming from EODHD into `dividends`; build the calendar, annual income forecast, and a dividend-safety rating (research Snowball's 13-criteria in Cowork).
3. **Analytics**: time-weighted return, benchmark vs. S&P 500 / indices, diversification by sector/country/asset class, "why is it moving".
4. **Corporate actions** (schema in blueprint), **rebalancing**, **categories/pies** UI.
5. **Polish**: CSV/broker-statement import, watchlists, notifications, 2FA, Stripe billing tiers.
6. **Broker sync** (SnapTrade) + PWA/mobile.

## Improvements over Snowball (the "adjust their flaws" layer)
- Fresher price data (their #1 user complaint is delayed prices).
- Tax reporting + realized-gain tracking (they have none).
- Looser free tier than their 10-holding cap.
- Multi-language from day one (they're English-only; i18next already in stack).

## Conventions
- Transactions are the source of truth; positions/totals are computed views.
- Shared reference tables (`instruments`, `price_cache`, `dividends`) are written server-side with the Supabase service role; clients read only. RLS scopes all user data by `auth.uid()`.
- Keep each change building green (`npm run build`) before moving on.
- When you hit an unknown in Snowball's behavior (an endpoint shape, a screen's data), that capture happens in **Cowork** (browser + logged-in session), not here — ask the owner to run it there and drop the result into `docs/`.

## Setup
See `README.md` for Supabase + EODHD + Vercel setup and env vars.
