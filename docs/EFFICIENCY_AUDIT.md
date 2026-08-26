# Snowfolio — Efficiency, Cost & Sustainability Audit

**Date:** 2026-08-26 · **Scope:** whole repo + vendor stack, at current use / 10× / 100× / 12 mo / 36 mo · **Method:** six parallel domain audits (assets, database, tech debt, performance/cost, vendors/financials, architecture/process) + an adversarial verification pass on every removal candidate. **Nothing was removed, cancelled, or disabled in this audit.** Every claim carries file:line evidence in the audit transcript; every dollar figure is labeled **PE** (provider estimate, public pricing verified 2026-08-26) or **A** (assumption, stated). No invoices or runtime telemetry were reachable — pre-launch, ~1 real user, no analytics by design.

---

## Efficiency & Sustainability Score: **75 / 100** (forecast after remediation: ~88)

| Category | Weight | Score | Confidence | Primary waste/risk | Fix | Effort | Forecast |
|---|---|---|---|---|---|---|---|
| Cost efficiency & unit economics | 25% | 80 | Medium (no invoices) | Unlicensed Yahoo data is unpriced COGS; licensed floor (~$146/mo at 10×, PE) breaks a $5 price | Price Pro ≥ $8; complete EODHD options before charging | 1–2 wks (later) | 88 |
| Architecture & infra efficiency | 20% | 85 | High | No rate limiting on 3 provider fan-out routes; cron ceiling ~400–800 instruments; `listUsers()` unpaginated | Staleness gates + cooldowns; chunked sync at trigger | ~2 days | 92 |
| Code quality & maintainability | 20% | 72 | High | Premium sign logic ×8; todayIso ×7 (2 semantics); silent-failure forms (bug); stale CLAUDE.md; broken `npm test` | Consolidations + truth pass (Group 3) | ~1.5 days | 88 |
| Operational & process efficiency | 15% | 48 | High | **Zero observability** — cron failures invisible; CI security test may never have run; contacts unfilled; no restore drill | sync_runs + failure email; CI secrets; drill | ~2 days | 80 |
| Vendor & dependency efficiency | 10% | 82 | High | 18/18 deps used, $0 stack, no overlap — but the EODHD escape hatch is ⅓ implemented | Document gap now; implement before switch | 1–2 wks (later) | 90 |
| Product simplicity & customer efficiency | 10% | 85 | Medium | Exchange-code literacy on manual add; silent form failures | Ticker autocomplete (trigger-based); form fixes | ~1 day | 90 |

**Costs:** Verified actual: **none reachable**. Estimated current: **$0/mo** (all free tiers, confirmed structurally). 10× (~50 users): **$21–46/mo** on free data · **$121–146/mo** on licensed data (PE). 100× (~500 users): **~$166–186/mo** core · **~$391–486/mo** if broker sync ever opens to users (A). Potential dollar savings from cleanup: **~$0** — the stack already runs at the free-tier floor; the audit's value is drift-risk removal, silent-failure prevention, and avoiding a forced ~$100+/mo step-change. One-time optimization cost: ~3–5 founder-days of AI-session work. Break-even at 10×: **7–11 payers at $8/$5 on free data; 20–33 on licensed** → price Pro no lower than **$8/mo** (A).

---

## Headline findings

1. **RESOLVED by live pricing check: all three Vercel crons are legal on Hobby.** Since Jan 2026 Vercel allows 100 crons/project on every plan (once-daily on Hobby; all three comply), and `maxDuration=300` fits Hobby under Fluid compute. The earlier 2-cron worry is dead. **Still unverified:** whether `RESEND_API_KEY`/`EMAIL_FROM` are set in Vercel env — without them the alerts + digest crons silently no-op (`lib/email.ts:9-10`), and `EMAIL_FROM` defaults to Resend's test address which only delivers to the founder. *15-minute dashboard check; two shipped features may be silently dead.*
2. **The whole data layer rides on unofficial, non-commercial Yahoo, and the paid escape hatch is ⅓ built.** `eodhd.ts` implements 3 of 10 port methods with `options:false` — flipping the env switch today silently loses dividends, price history, enrichment, and **all options data** (the signature wedge). Hard gate: licensed data (+EODHD options implementation, quote needed) **before the first paid dollar**. True post-launch cost floor ≈ $100–130/mo (PE), which is why Pro pricing must assume it.
3. **Zero observability is the worst category.** All three crons return rich JSON summaries that nobody records; every failure path is a bare `catch`; 6 console statements in the whole app. The nightly sync's ceiling (~400–800 instruments, A) would starve the *same tail instruments every night, invisibly*. Cheapest fix set (~1 day): a `sync_runs` table, provider-call counters, `console.error` in catches, and a failure email to the founder.
4. **Bug-grade inconsistency found:** `addOptionTransaction` and `addCashEntry` silently `return` on invalid input while their forms reset — false success; a mistyped expiration means the leg never exists and income is silently understated (the exact "confident wrong number" the product forbids). Also **`npm test` is broken** (verified empirically: exit 1 MODULE_NOT_FOUND; the glob form works) while CI happens to call `test:rls` directly.
5. **The docs layer misleads the AI workforce.** CLAUDE.md indexes ~13 docs; 8 were never committed (they live only in Cowork) — including the COST_MODEL and MARKET_DATA_ADAPTER files that code comments cite. CLAUDE.md also still claims the marketdata port refactor is *pending* when it is **done** — a future session could destructively "re-do" it. README documents 4 of 11 env vars (a fresh deploy following it ships with dead crons), leads EODHD-first, and promises native apps that CLAUDE.md forbids.
6. **The cheapest high-value spend in the stack:** buy `snowfolio.app` (~$15/yr, PE) + verify it in Resend (free). Without it, notification email to anyone but the founder cannot work at all.
7. **Two free tiers prop each other up:** the daily Vercel cron's API traffic resets Supabase Free's 7-day pause timer — so Supabase cannot pause *while the cron runs*. Correlated failure: if the cron dies for 7+ days, the database pauses too. One more reason for the failure email.
8. **Growth math is benign:** storage grows single-digit MB/yr at founder scale vs Supabase Free's 500MB; the only provably-free future prune is `iv_history` rows older than ~13 months (its sole reader uses a 365-day window). Computed views stay fast until ~100k+ total transaction rows (A) — low thousands of users.

---

## A. Removal candidates — post-verification (approval required for every action)

The adversarial pass **refuted 7 of 10 "unused" claims** — the survivors are small, and that is the point.

### Group 1 — Remove now, after your approval (confirmed unused, reversible, evidence held)

| Item | Evidence | Risk | Rollback |
|---|---|---|---|
| `getRates()` + `FALLBACK_USD_RATE` (lib/marketdata/index.ts:98-138) + stale header comment | Verifier-confirmed: zero callers incl. dynamic refs; orphaned by the getCachedRates migration; duplicates lib/fx.ts's live FX table — **two hand-edited FX tables will drift into a wrong number** | None (tsc/build prove it) | git revert |
| `docs/CLAUDE_md-patch.md` | Verifier-confirmed: applied in commit 9093387, content verbatim in CLAUDE.md since diverged; live hazard — a future AI session could re-apply it as pending instructions | None (git history preserves it) | git revert |
| Redundant indexes `price_history_inst_idx` + `iv_history_symbol_idx` (schema.sql:150, :529) | Exact duplicates of their PKs (Postgres scans btrees backwards natively); double write amplification on the two fastest-growing tables | None | re-run one CREATE INDEX each |

*Optional third index `cash_ledger_portfolio_idx` — prefix of the dedupe unique index; lowest value, fine to leave.*

### Refuted — retain (the audit's false positives, kept with reasons)

- **`portfolio_totals` view** — "unused" refuted: consumed by the CI RLS isolation test (tests/rls.test.mjs:189-190) and named in LAUNCH_RISK_REVIEW's security contract. Note: its currency math is naive — never wire it into the UI without FX; add a comment.
- **`/api/backfill` route** — "duplicate" refuted: the only headless deep-backfill path (CRON_SECRET bearer, `?days=` 400–4000 vs the action's fixed 2600); server actions can't be curl'd. Keep as documented break-glass, or delete knowingly.
- **`getOptionQuote` + `providerSupportsOptions`** — "unused" refuted: mandated API surface of docs/SPEC_options-selling.md:66-71; `providerSupportsOptions` is the only built gate for the EODHD degradation path. Keep with a "reserved for O2" comment (or amend the spec first).
- **`HANDOFF.md`** — likely the non-coding owner's own relaunch runbook; only the owner can confirm. Ask before touching.
- **CLAUDE.md's 8 dangling doc entries** — not dead references but the *repair manifest* for docs that exist in Cowork; backfill, don't prune (preferred).
- **`categories` table + 21 portfolios columns + 15 instruments columns + `roll_group_id`** — genuinely zero runtime consumers, but deliberate Snowball-blueprint scaffolding that CLAUDE.md instructs mirroring; near-zero carrying cost. **Retain intentionally**, annotate live-vs-reserved in schema.sql.
- **`npm test` script** — not a duplicate: it's the npm-convention entry point and it's *broken*. **Repair** (`node --test "tests/**/*.test.mjs"`, verified exit 0), don't remove.

### Decommissioning sequence for anything approved
1 confirm owner + dependencies → 2 build/tsc proof → 3 delete on a branch, one commit per item → 4 CI green → 5 push; DB index drops additionally: run `drop index` live + delete the schema.sql line so re-runs don't recreate. All rollbacks are `git revert` / one CREATE INDEX.

---

## B–C. Simplification & performance (Group 3 — fix during remediation, approval requested as a batch)

**Correctness-grade (do first):**
1. **Silent-failure forms** — make `addOptionTransaction`/`addCashEntry` throw like `addTransaction`; add try/catch+error display to AddCashEntryForm (~1 hr).
2. **`npm test` repair** — glob form (~5 min).
3. **`legPremium` consolidation** — one helper in lib/options.ts replacing the 6 TS copies (SQL views stay, cross-referenced by comment) + the repo's **first money-math unit test** (~45 min). One future edit to one copy currently skews tax vs digest vs holding pages silently.
4. **schema.sql positions-view header comment** contradicts its own implementation on premium-in-cost-basis — 5-min fix that prevents re-introducing a fixed double-counting bug.

**Cost-amplification (protects the shared Yahoo dependency all users ride on):**
5. **refreshPrices staleness gate** — skip instruments with `price_cache.as_of` < ~2 min (~5 lines): bounds a hostile clicker from ~180k Yahoo calls/hr to 1 call/instrument/2min globally (>95% reduction, A).
6. **CSV import fan-out** — fan out only for instruments *created* this import, batched; today a re-import of the same file re-fires up to ~2,000 provider calls and dies at the 60s wall mid-flight (~half day).
7. **Put-finder** — serve quotes from price_cache (<15 min) + a shared 10-min scan-result cache + per-user cooldown (~1 day).
8. **Digest/alerts loop hoists** — FX read + `listUsers` map outside the per-user loop; **fix unpaginated `auth.admin.listUsers()`** in the sync (breaks the founder's own broker sync past ~50 registered users, PE) — resolve owners via `broker_connections.user_id` instead (~30 min).
9. **Digest idempotency** — write a week-keyed `sent_notifications` row (alerts already does).

**Observability (~1 day, the highest-leverage item in the audit):**
10. `sync_runs` table storing each cron's already-built JSON + duration + failed symbols; `console.error` in every bare catch; provider-call counters; **email the founder the summary whenever `failed>0` or `synced==0`** (uses the existing sendEmail, no new vendor).

**Docs truth pass (~1–2 hrs):** CLAUDE.md — port is DONE, mark Cowork-only docs, index the 2 SPEC_broker-sync docs; README — all 11 env vars (or point at .env.local.example), Yahoo-default, drop native-apps line; add `NEXT_PUBLIC_SITE_URL` to the example; annotate reserved schema columns; add missing `transactions(instrument_id)` + `option_transactions(instrument_id)` indexes.

**Bundle:** recharts compiles 3 separate ~325KB copies (measured) into dashboard/performance/options chunks, never lazy-loaded — `next/dynamic` the four charts (~2 hrs, ~95KB gzip off dashboard first paint, A); optionally replace the dashboard's lone pie with a hand-rolled SVG donut. Dashboard page: parallelize its ~8 sequential awaited round trips (options page already shows the pattern) (~1 hr, est. 300–500ms TTFB, A). Middleware: narrow the matcher so signed-in marketing navigation stops paying a Supabase auth round trip (~30 min).

**Deliberately NOT simplified:** the two 630+-line pages (extraction is premature until first math bug / second consumer / unit-testing decision — triggers named), the timeline/event builder duplication (opportunistic only), the FIFO mapping boilerplate (bundle with #3).

---

## D–E. Financials & vendors (detail)

**Vendor rationalization (one verdict each):** Vercel **Keep** (Pro $20/mo is ToS-mandatory at first revenue — Hobby is non-commercial; not before). Supabase **Keep** (deepest lock-in, bought deliberately; Pro $25/mo at first external/paying user for backups+no-pause; until then weekly `pg_dump` habit). Yahoo **Replace at monetization** (not because OSS exists — because commercial use of the feed is outside its terms). EODHD **Defer pending usage data** (do NOT prepay the $999.90 annual while its options coverage is unverified; get the options-data quote first). SnapTrade **Keep owner-only** — the gate is also the stack's most important implicit budget cap (~$225–300/mo at 100× with 30% attach, A; would exceed hosting+data+DB combined). Resend **Keep** (raw-fetch, least locked-in vendor; free tier's **100/day** cap breaks daily alerts at ~50–100 opted-in users — Mondays halve it; $20/mo tier then). GitHub/domain **Keep** / **acquire**.

**Commitment policy:** month-to-month everything until 3 months of real invoices exist; keep Vercel Spend Management (default-on, set pause-at-~$40, A) and Supabase's default-on spend cap when those plans arrive.

**Data the founder must supply to make the model real:** Vercel usage page + plan; Supabase DB-size + plan; Resend dashboard (is the key set? send counts); SnapTrade tier; domain receipt; EODHD options quote; once live — conversion, churn, broker-attach rate; processor fee schedule.

---

## F. Architecture: three views

**KEEP NOW (defended):** transactions-ledger + computed security_invoker views (the repo's best decision — no recompute jobs, no cache invalidation); single Next.js monolith; read-from-cache with vendor calls confined to the nightly cron (vendor cost O(instruments/day), not O(pageviews)); RLS everywhere + zero-policy secrets table + CI isolation test; both provider ports with env-switch exits; idempotent dedupe keys end-to-end (retry-by-rerun ≈ queue semantics for free); no analytics; FirstRun onboarding; one re-runnable schema.sql *for a solo author* (until the migration trigger).

**IMPROVE BEFORE SCALE (numeric/event triggers):** licensed market data — **first paid subscription** (hard gate, alongside entity formation); CI RLS secrets + staging project — **now** (a green check that proves nothing is worse than none); error monitoring layer 2 (Sentry free) — **~25–50 users**; Supabase Pro — **first external user with real data**; restore drill — **before first external user, then quarterly**; migrations discipline + one-time `supabase db diff` drift check — **second contributor / first paying user / first destructive change** (drift mechanism is demonstrated: `create table if not exists` swallows later columns; the file already carries back-fill patches proving the authors know); chunked cron sync — **>~400 instruments or duration >200s**; Resend paid — **~50 opted-in users**; rate limiting — **>~50 DAU or first Yahoo 429**; branch protection + PR flow — **second contributor or first paying user** (today a red CI still auto-deploys to prod); ticker autocomplete via the existing `searchInstrument` — **first support emails about failed symbol adds**; per-user broker sync — **sustained requests + revenue that covers ~$1.50–2/user/mo**, priced paid-tier-only.

**AVOID (attractive complexity, no trigger exists):** microservices/separate API; queues/event bus; Redis/edge cache (price_cache/fx_rates ARE the cache); k8s; GraphQL (the mirrored blueprint is REST); event-sourcing frameworks (the ledger already is event sourcing done simply); read replicas/multi-region; feature-flag platform; native apps; multi-provider automatic data blending (would undermine "never a confident wrong number"); materializing the positions view before ~1M ledger rows.

**Single points of failure:** Yahoo (blast HIGH/likelihood MED — exit built, ⅓ complete); **the founder** (blast TOTAL — password-manager emergency access, fill INCIDENT_RESPONSE §5 blanks, one-page bus-note: cheapest existential mitigation in the audit); Supabase (exit = vanilla pg_dump, fine); Vercel (crons are bearer-authed → any external scheduler is a drop-in contingency); Resend (one 15-line fetch wrapper); SnapTrade (blast radius = founder's own dashboard only, by design).

**Enterprise/36-month (flag only, earliest ~24 mo):** SSO/SAML, audit logs of service-role writes, data residency, SOC2 (cheap prep = the evidence binder LAUNCH_RISK_REVIEW already prescribes), SLAs/status page.

## H. Process
Worst-scaling founder-dependent task is **noticing failures** (fixed by observability). DSAR surface already mostly self-serve (in-app deletion + CSV exports); start the request log the day the inbox goes live. SnapTrade dashboard tasks scale with the founder's accounts, not users. No help center needed under ~100 users (A); write the FAQ from real emails. Release path: push-to-main is fine solo; gate at the named trigger.

## Telemetry gaps (measure before deciding) — 5
Vercel cron run history (all 3 paths) + effective function timeout · `RESEND_API_KEY`/`EMAIL_FROM` present in Vercel env + Resend send counts · the three CI repo secrets present · Supabase dashboard DB size · feature usage (finder/alerts/digest) — needs `sync_runs`/counters first.

## Premature optimizations to avoid — 5
Materializing/denormalizing positions · any queue/Redis/second datastore · splitting the two big pages · EODHD subscription or annual prepay before the options quote · Supabase Pro/Vercel Pro before their named triggers.

---

*Audit only — no removals, cancellations, or disablements were performed. Group 1 items await explicit approval; Group 3 is proposed as a remediation batch; everything else is trigger-based. Full per-domain findings with file:line evidence live in the session's audit transcript.*
