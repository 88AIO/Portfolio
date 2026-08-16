# Snowfolio — Project Brief (for Claude Code)

You are continuing an existing build. Read this file, the `docs/` index (bottom of this file), and `docs/API_BLUEPRINT.md` before writing code.
Note: this repo uses **Next.js 16** (App Router, Turbopack) — some APIs differ from older Next; `cookies()` is async, and middleware lives in `proxy.ts` (not `middleware.ts`).

## What we're building
A calm **portfolio tracker for performance + income** (dividends **+** option premium), **tailored to options sellers** (covered calls, cash-secured puts, the wheel) — the power of Snowball Analytics without the overwhelm, and honest about its data. Owner is a solo builder (faceless personal-finance creator) who does not code — write the code, run it, and explain steps plainly.

- **Market:** **US-first, highlighted.** US is the primary market and gets the deepest coverage + the UI/marketing spotlight. International stocks are **supported** (a differentiator vs. US-only rivals) but never the lead.
- **Platform:** **web-only** — one responsive web app (installable PWA). **No native mobile apps.**

## Product principles (from Cowork strategy)
- Simple by default, depth on demand: the home screen answers only "what do I own / what's it worth / what income is coming." Advanced (backtest, X-ray, deep metrics) is one tap deeper, off by default.
- Honest data: "prices as of…" timestamps; return-of-capital transparency on yield ETFs; never a confident wrong number.
- No duplicates: same holding across accounts rolls up to one position; imports are idempotent (dedupe transactions).
- Options: track & inform, never advise. No trading terminal, no multi-leg builder, no "sell this" recommendations.
- No ads, no upsell, no cold calls. Generous free tier. Export / no lock-in.

## Target model (source of truth for API shapes)
`docs/API_BLUEPRINT.md` (plus the other `docs/API_*.md` captures) is the reverse-engineered spec of the real Snowball API/data model, captured from live authenticated sessions. Mirror its shapes for the features we choose to build (we are selectively matching Snowball, not cloning it 1:1):
- Snowball's real backend is REST at `/extapi/api/` (ASP.NET/C#). Ours mirrors the same resources as Next.js route handlers under `app/api/`.
- **Portfolio** = 38-field config (goals, tax rules, composite "pie" portfolios, broker sync, sharing, categories).
- **Holding/Position** = ~117 fields, almost all **computed** at query time from raw transactions + instrument reference + dividend history. Do NOT store computed fields — compute them.
- Standard **paginated envelope**: `{ data:[…], totalCount, page, pageSize, sortBy, sortDirection }`.
- Every list/aggregate endpoint takes a `currency=` param and converts server-side.

## Stack (already chosen)
Next.js 16 (App Router) · TypeScript · Supabase (Postgres + Auth) · Tailwind · Recharts · market data via the `lib/marketdata` **provider port** (Yahoo free default → EODHD to scale). Deploy on Vercel. One language end-to-end.

## Market data
Behind the `lib/marketdata` provider port. Default provider = `yahoo` (free, US incl. options) for personal/dev; switch to `eodhd` via env `MARKET_DATA_PROVIDER` to scale. App reads cached DB tables; only the nightly sync calls a provider. See `docs/MARKET_DATA_ADAPTER.md` and `docs/COST_MODEL.md`.

## What already exists (current state)
- Auth (email/password + OAuth-ready), session handling in `proxy.ts`.
- `supabase/schema.sql` — v2, modeled on the blueprint: `profiles, portfolios (full config), categories, instruments (reference+fundamentals+div), transactions, price_cache, dividends`, plus `positions` and `portfolio_totals` views that compute Snowball-style fields.
- Dashboard: summary cards (market value, cost, P/L, day P/L, est. annual dividends + yield), holdings table with per-holding yield, allocation donut. Multi-currency totals via server FX.
- `lib/marketdata.ts` — currently calls EODHD directly for quotes, FX, instrument search (to be refactored behind the provider port described above, with Yahoo as the free default). `app/dashboard/actions.ts` — add transaction, refresh prices.
- Verified: `npm run build`, `tsc`, and `eslint` all pass.

## Roadmap (wedge-first — see `docs/ROADMAP_v2_wedge-first.md`)
```
NOW  — calm holdings + dashboard (Option A), correctness + "prices as of", US-first coverage,
       excellent idempotent CSV/manual import, basic performance (value/total return).
NEXT — dividend engine (calendar, forecast) + dividend-safety score shown as a calm 0–100;
       packaging (generous free tier, no ads/upsell, export).
NEXT+ (signature) — Options-selling layer: O1 seller cockpit → O2 wheel + alerts → O3 opportunity finder.
       Track & inform, never advise. See docs/SPEC_options-selling.md.
LATER — advanced analytics (opt-in), corporate actions, rebalancing, US tax report,
       broker auto-sync (SnapTrade), community.
```

## Improvements over Snowball (the "adjust their flaws" layer)
- Fresher, honest price data with "prices as of…" transparency (delayed prices are their #1 user complaint).
- Tax reporting + realized-gain tracking (they have none).
- Looser free tier than their 10-holding cap.
- The signature wedge no rival owns: dividends **+** option premium in one calm income picture for options sellers.

## Conventions
- Transactions are the source of truth; positions/totals are computed views.
- Shared reference tables (`instruments`, `price_cache`, `dividends`) are written server-side with the Supabase service role; clients read only. RLS scopes all user data by `auth.uid()`.
- Keep each change building green (`npm run build`) before moving on.
- When you hit an unknown in Snowball's behavior (an endpoint shape, a screen's data), that capture happens in **Cowork** (browser + logged-in session), not here — ask the owner to run it there and drop the result into `docs/`.

## Strategy & capture docs (docs/)
- API_*.md ............... reverse-engineered Snowball endpoints (main-stats, growth/benchmark, dividend calendar, backtest/rebalancing/screener, dividend-safety rating)
- MARKET_DATA_ADAPTER.md . provider port (free Yahoo now, EODHD later, one env switch)
- COST_MODEL.md .......... run costs (solo ~$0 on free data; commercial tiers)
- COMPETITIVE_BRIEF.md ... rivals + where we win (the empty seat)
- PRODUCT_NOTES_user-feedback.md . calm-by-default + no-duplicates principles
- POSITIONING_where-we-win.md .... one-page positioning
- ROADMAP_v2_wedge-first.md ...... build order
- FEATURES_borrowed-best.md ...... features to steal from rivals (alerts, income goal, attribution, Income Health digest…)
- SPEC_options-selling.md ........ the options-selling PRD (O1/O2/O3)

## Setup
See `README.md` for Supabase + EODHD + Vercel setup and env vars.
