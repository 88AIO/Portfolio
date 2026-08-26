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
Behind the `lib/marketdata` provider port (**done** — `lib/marketdata/index.ts` + `providers/{yahoo,eodhd}.ts`). Default provider = `yahoo` (free, US incl. options) for personal/dev; switch to `eodhd` via env `MARKET_DATA_PROVIDER` to scale. **Caveat:** the eodhd provider implements quotes/FX/search only — dividends, price history, and option chains are Yahoo-only today; complete it before switching production. App reads cached DB tables; only the nightly sync calls a provider. (MARKET_DATA_ADAPTER / COST_MODEL docs were authored in Cowork and are not in this repo — see the docs index note below; `docs/EFFICIENCY_AUDIT.md` carries the current cost model.)

## What already exists (current state)
- Auth (email/password + OAuth-ready), session handling in `proxy.ts`; password reset; self-serve account deletion.
- `supabase/schema.sql` — v2, modeled on the blueprint: `profiles, portfolios (full config), categories, instruments, transactions, option_transactions, cash_ledger, price_cache, price_history, dividends, fx_rates, iv_history, sync_runs, finder_scans`, plus `positions`/`portfolio_totals`/`option_positions` computed views. RLS throughout; live-vs-reserved columns annotated in the file.
- Full dashboard suite: overview, performance (with SPY benchmark), dividends, options cockpit + wheel + put finder, tax (FIFO realized gains), cash, broker sync (owner-only), settings. Marketing site + blog/changelog + legal pages.
- Three Vercel crons (`vercel.json`): nightly market-data sync, daily alerts, weekly digest — each records its run into `sync_runs`.
- Tests: `npm test` (offline money-math), `npm run test:rls` (cross-tenant isolation; runs in CI when secrets are set).
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
In this repo:
- API_BLUEPRINT.md ............... reverse-engineered Snowball API/data model (the target model above)
- SPEC_options-selling.md ........ the options-selling PRD (O1/O2/O3)
- SPEC_broker-sync.md ............ broker auto-sync spec (SnapTrade, per-user flow design)
- SPEC_broker-sync-etrade-options.md . E*Trade options-import capture notes
- INCIDENT_RESPONSE.md ........... breach/incident one-pager (severity, containment by stack, notification clocks)
- LAUNCH_RISK_REVIEW.md .......... B2C pre-launch risk review (verified anchors, gated launch decision, MVL stack) — issue-spotting, not legal advice
- EFFICIENCY_AUDIT.md ............ efficiency/cost/sustainability audit (scorecard, cost model, removal candidates w/ approval gates, scale triggers)

Authored in Cowork, **not in this repo** (don't search for them here — ask the owner to export if needed): MARKET_DATA_ADAPTER.md, COST_MODEL.md, ROADMAP_v2_wedge-first.md, COMPETITIVE_BRIEF.md, POSITIONING_where-we-win.md, FEATURES_borrowed-best.md, PRODUCT_NOTES_user-feedback.md, and the other per-endpoint API_*.md captures. The roadmap summary above and EFFICIENCY_AUDIT.md's cost model are the in-repo stand-ins.

## Setup
See `README.md` for Supabase + EODHD + Vercel setup and env vars.
