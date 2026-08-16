# CLAUDE.md — patch to current strategy

*Apply these edits to the repo's `CLAUDE.md` so Claude Code builds to the decisions made in Cowork. Paste into Claude Code and let it apply, or edit by hand.*

## 1) Replace the "Stack" line's market/platform framing
The brief currently says *"US + Asian markets focus"* and the roadmap lists *"PWA/mobile."* Update the top-of-file description and stack note:

- **Market:** **US-first, highlighted.** US is the primary market and gets the deepest coverage + the UI/marketing spotlight. International stocks are **supported** (differentiator vs US-only rivals) but never the lead. *(was "US + Asian")*
- **Platform:** **web-only** — one responsive web app (installable PWA). **No native mobile apps.**
- **What we're building (revise):** a calm **portfolio tracker for performance + income** (dividends **+** option premium), **tailored to options sellers** (covered calls, cash-secured puts, the wheel) — the power of Snowball without the overwhelm, honest about its data.

## 2) Add a "Product principles" block
```
## Product principles (from Cowork strategy)
- Simple by default, depth on demand: the home screen answers only "what do I own / what's it worth / what income is coming." Advanced (backtest, X-ray, deep metrics) is one tap deeper, off by default.
- Honest data: "prices as of…" timestamps; return-of-capital transparency on yield ETFs; never a confident wrong number.
- No duplicates: same holding across accounts rolls up to one position; imports are idempotent (dedupe transactions).
- Options: track & inform, never advise. No trading terminal, no multi-leg builder, no "sell this" recommendations.
- No ads, no upsell, no cold calls. Generous free tier. Export / no lock-in.
```

## 3) Replace the Roadmap with the wedge-first order
Point `§Roadmap` at `docs/ROADMAP_v2_wedge-first.md`. Summary order:
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

## 4) Market-data is behind a provider port
```
## Market data
Behind the `lib/marketdata` provider port. Default provider = `yahoo` (free, US incl. options) for personal/dev;
switch to `eodhd` via env `MARKET_DATA_PROVIDER` to scale. App reads cached DB tables; only the nightly sync calls a provider.
See docs/MARKET_DATA_ADAPTER.md and docs/COST_MODEL.md.
```

## 5) Add the docs index
```
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
```
