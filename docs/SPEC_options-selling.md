# Spec — Snowfolio Options-Selling Layer

*Feature PRD for Claude Code. Stack: Next.js 16 (App Router) · TypeScript · Supabase · `lib/marketdata` provider port. Scope-locked: web-only, US-first, **track & inform — never advise**. Builds on the existing `transactions → positions` model. Maps to the reverse-engineered Snowball shapes in `docs/API_*.md`.*

## Problem statement
Income investors who **sell options** (cash-secured puts, covered calls, the wheel) have nowhere calm to track it: dividend trackers ignore option premium, and the options tools are trading terminals. The owner and much of the target audience do this regularly (their real portfolios hold XDTE/QYLD/YMAX). Today they use spreadsheets. Snowfolio can own "**all my stock income — dividends + option premium — in one honest, calm place**," a position no competitor holds.

## Goals
1. A user can record every option they've **sold** and see, at a glance, **total income (dividends + premium)**, **annualized return-on-capital**, **upcoming expirations/assignments**, and **cost-basis reduction**.
2. Option premium flows into the **same income and cost-basis math** as dividends (one integrated picture, not a bolt-on).
3. Runs on the **free US options data** already available via the `lib/marketdata` port — no new paid feed, no broker sync.
4. Never crosses into advice or a trading terminal — it tracks and informs only.

## Non-goals (explicitly out of scope for v1)
- **Multi-leg/spread builder** and buy-to-open speculation flows as first-class — off-thesis, huge scope.
- **Trade execution / broker order routing** — we're a tracker.
- **Trade recommendations** ("sell this put") — regulatory + ethos line. We show metrics, never calls to act.
- **Real-time streaming quotes** — daily/last marks are enough for a tracker.
- **International options** — thin free data; US-first by design.
- **Tax filing/reporting for options** — deferred to the later tax-report feature; caveat "not tax advice."

## User stories

**Seller cockpit (O1 — P0)**
- As an options seller, I want to **log a sold put/call** (underlying, strike, expiry, contracts, premium) so my income and risk are tracked.
- As an income investor, I want **total income = dividends + premium** in one number so I see my whole yield.
- As a wheel seller, I want **annualized return-on-capital** per position so I can compare trades on one yardstick.
- As a cautious seller, I want to see **which positions are near expiry or likely assignment** so nothing surprises me.
- As a holder, I want **premium to lower my effective cost basis** on the underlying so my P/L reflects reality.

**Wheel + alerts (O2 — P1)**
- As a wheel seller, I want a **put → assignment → covered call → called-away** cycle tracked as one story with total income across it.
- As a busy seller, I want an **alert** when an option nears expiry/assignment or a dividend goes ex.

**Opportunity finder (O3 — P2)**
- As a seller with cash to deploy, I want US stocks **ranked by cash-secured-put premium** (annualized RoC) beside **IV rank** and **dividend-safety**, so I can spot rich premiums on names I'd be glad to own — clearly **informational, not advice**.

## Requirements

### P0 — Seller cockpit (O1)

**Data model** (extend `supabase/schema.sql`; transactions stay the source of truth):
```
option_transactions
  id, portfolio_id -> portfolios, instrument_id -> instruments (underlying),
  action            enum: sell_to_open | buy_to_close | expired | assigned | rolled
  option_type       enum: put | call
  strike            numeric
  expiration        date
  contracts         int              -- 1 contract = 100 shares
  premium           numeric          -- per share, signed (+ received, − paid to close)
  fee               numeric default 0
  trade_date        date
  currency          text default 'USD'
  roll_group_id     uuid null        -- links rolled/wheel legs (O2)
  linked_txn_id     uuid null        -- assignment -> the equity transaction it created
  note              text null
```
- **`option_positions` view** (compute like `positions`): net open contracts per (underlying, type, strike, expiration) = Σ sell_to_open − buy_to_close, excluding expired/assigned/closed. Derive **covered vs cash-secured**: a short call is *covered* when the portfolio holds ≥ `contracts×100` shares of the underlying (join `positions`); otherwise naked (flag it, don't block).
- **Computed fields per open position:** `premiumCollected` (net, realized on close/expire/assign), `collateral` (put: `strike×100×contracts`; covered call: underlying market value of the covered shares), `dte` (`expiration − today`), `annualizedRoC` = `premiumNet / collateral × 365 / max(dte,1)`, `distanceToStrike` = `(underlyingPrice − strike)/underlyingPrice`, `status` (on_track | may_be_assigned [ITM near expiry] | high_iv | expired | assigned).
- **Integration:**
  - `total_income = dividends + net option premium` — extend the income tile + `divs`-style summary.
  - **Cost-basis reduction:** premium from assigned puts and from calls written against a holding reduces that holding's effective cost basis in the `positions` view.
  - Income calendar (from the dividend engine) also shows **option expirations**.

**Market-data port additions** (`lib/marketdata/types.ts` + providers):
```ts
getOptionQuote(underlying, exchange, type, strike, expiration): Promise<OptionQuote>  // { mark, bid, ask, iv, openInterest }
getOptionChain(underlying, exchange, expiration?): Promise<OptionChain>
```
- Yahoo provider implements via `yahooFinance.options(symbol, { date })` (free, US). EODHD provider left as a stub / later. Capability flag `options: boolean`.

**API (route handlers under `app/api/`, mirroring the captured `/extapi` contracts):**
- `GET  /api/options?portfolioId=&showClosed=&currency=` → paginated envelope `{ data: OptionPosition[], totalCount, page, pageSize, sortBy, sortDirection }` (same envelope as captured `holdings`).
- `POST /api/options` → create an `option_transactions` row.
- `POST /api/options/totals?portfolioId=&currency=` → the four cockpit metrics `{ totalIncome, dividendIncome, premiumIncome, avgAnnualizedRoC, expiringCount, expiringPremium, costBasisReduction }`.

**Acceptance criteria (P0):**
- [ ] Given I add a sold put (AAPL $210, Apr 18, 2 contracts, $1.56/sh premium), when I open Options, then I see it as an open position with premium $312, collateral $42,000, DTE, and annualized RoC computed correctly (`312/42000×365/DTE`).
- [ ] Given I hold 100+ MSFT shares and sell a call against them, then it's labeled **Covered call**; if I don't hold shares, it's flagged **naked** (allowed, warned).
- [ ] Given an open short put is ITM within 5 days, then its status shows **May be assigned**.
- [ ] Total income on the home/Options view equals dividends **+** net premium.
- [ ] Assigning a put creates a linked equity buy at the strike and reduces the underlying's cost basis by the premium.
- [ ] All values convert to the requested `currency` server-side; US options only (non-US underlyings show "options not supported").
- [ ] No screen anywhere says "sell/buy this" — copy is descriptive only.

### P1 — Wheel + alerts (O2)
- **Wheel linking:** `roll_group_id` chains legs; a cycle view shows put → shares → call → called-away with **income across the whole cycle** and blended RoC.
- **Alerts (opt-in, batched — see `FEATURES_borrowed-best.md` #1/#6):** expiry/assignment approaching, ex-dividend upcoming, safety downgrade. Email + web push. Feeds the weekly **Income Health digest**.
- Acceptance: rolling a position (buy_to_close + sell_to_open with same `roll_group_id`) keeps one cycle with summed premium; the weekly digest lists expirations and premium collected.

### P2 — Opportunity finder (O3)
- **Ranking:** for a **curated US optionable universe** (liquid names + the user's watchlist), pull ~30–45 DTE puts ≈5–7% OTM, compute annualized RoC, attach **IV rank** and **dividend-safety score**; rank by RoC.
- **API** mirrors the captured screener contract exactly (`docs/API_backtest-rebalancing-screener.md`):
  `POST /api/screener/put-finder` — request `{ filters: [{ name, options } | { name, min, max }] }` → `{ totalCount, visibleCount, calcDate, availableFields, data: FinderRow[] }` where `FinderRow = { ticker, sector, price, putStrike, dte, premium, annualizedRoc, ivRank, divSafetyScore }`.
- **Guardrails on-screen:** "Informational only — not a recommendation"; IV rank colored low→high so rich-but-risky is obvious; dividend-safety shown to nudge toward quality.
- **Data cost note:** bounded universe pulled **nightly and cached** keeps it inside free-tier limits (see `COST_MODEL.md`). Log if the universe is truncated — never imply full coverage.

## Success metrics
- **Leading:** % of active users who add ≥1 option position within 30 days (target 25% of the options-selling segment); finder usage per weekly active options user; % who say total-income view "replaced my spreadsheet" (survey).
- **Lagging:** retention lift among users with ≥1 option position vs. dividend-only users; conversion to paid among heavy options users.

## Open questions
- **IV rank source** (eng/data): Yahoo gives current IV, not IV rank. Build a small `iv_history` nightly cache to compute 52-week IV rank? Blocking for O3 only.
- **Assignment detection** (eng): auto-detect assignment from expiry+ITM, or require the user to confirm? Lean confirm-to-avoid-wrong-data. Non-blocking for O1.
- **Premium entry UX** (design): enter premium **per share** or **total**? (Sellers think in per-share × contracts.) Non-blocking.
- **Finder universe** (product): which US tickers seed the universe (S&P 500 + popular optionable ETFs + watchlist)? Blocking for O3.

## Timeline / phasing
- **O1 (P0)** — cockpit + integration into total income & cost basis. Ships after the dividend/income core (per `ROADMAP_v2` NEXT+). No new data cost.
- **O2 (P1)** — wheel linking + alerts + Income Health digest.
- **O3 (P2)** — opportunity finder (needs the IV-rank cache + universe decision).

*Cross-refs: `docs/API_main-stats.md`, `docs/API_backtest-rebalancing-screener.md` (screener contract), `MARKET_DATA_ADAPTER.md`, `COST_MODEL.md`, `ROADMAP_v2_wedge-first.md`, `FEATURES_borrowed-best.md`.*
