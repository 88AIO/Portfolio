# Snowfolio — Operational Readiness Audit (2026-09-27)

Full-stack audit of what is live today and what stands between it and a public launch: hosting,
endpoints, database, auth, crons, email, observability, repo, legal. Follows
`QC_SCORECARD_2026-09-11.md`; items that audit closed are not repeated. No domain name has been
chosen yet; everything that depends on one is grouped under "Domain day".

**Verdict:** the engine is production-grade and, after the fix pass below, every area that can be
fixed in code or in the live database scores 100. The site is still **not usable by the public**:
it has no domain, so it cannot be reached, cannot send sign-up or password-reset emails, and names
a support inbox that doesn't exist. What's left is a short list of steps only the owner can take
(buying things, account settings, legal).

## Scorecard

"Before" is the first pass this morning; "Now" is after the fix pass (code on branch
`claude/practical-cori-jhrop4`, database changes already live); "Ceiling" is what each area
reaches once the owner steps at the bottom are done.

| Area | Before | Now | Ceiling | What's left (who) |
|---|---:|---:|---:|---|
| Code quality & CI | 92 | **100** | 100 | — (merge the branch) |
| Database & tenant isolation | 92 | **100** | 100 | — |
| API endpoints & auth gates | 90 | **100** | 100 | — (merge the branch) |
| Data pipeline (crons) | 90 | **100** | 100 | — |
| Hosting & scaling (Vercel) | 75 | **90** | 100 | domain + firewall (owner; the API refuses until the Firewall tab is opened once) |
| Auth hardening | 65 | **88** | 100 | leaked-password check, min length 8, Turnstile keys, your own 2FA (owner) |
| Observability & alerting | 70 | **80** | 100 | uptime monitor once public; confirm Sentry alerts reach you (owner) |
| Backups & disaster recovery | 55 | 55 | 100 | one test restore (owner) |
| Repo hygiene | 50 | 60 | 100 | make the repo private, protect `main` (owner) |
| Transactional email | 25 | 25 | 100 | needs the domain: Resend + Supabase SMTP (owner) |
| Domain & public access | 15 | 20 | 100 | buy the domain (owner) — snowfolio.app is available, $9.99 then $15/yr |
| Legal & compliance | 35 | 35 | 100 | entity, attorney review, support inbox (owner + professionals) |
| Monetization | 15 | 15 | — | not needed for a free launch |
| Data accuracy (prices, sync) | — | **100** | 100 | 2 price-history bugs found and fixed (see QC pass 3) |
| Benchmark & return math | — | **100** | 100 | TWR + XIRR + S&P total return; opening-lot inflation removed |
| Page speed (Core Web Vitals) | — | **100** | 100 | Lighthouse mobile 98–99, every metric "good" (pass 4) |
| **Engineering core** | **89** | **100** | 100 | |
| **Public-launch readiness** | **59** | **68** | 100 | the owner steps below |

*Second pass (same day):* every live figure was re-read from Vercel and Supabase and a
column-level drift check was added; corrections are folded in (migration count, email
confirmation verified on, region verified from the deployment record).

## Fix pass (same day)

Everything below is either live in the database now or on the branch, green in CI.

**Database (applied to production, recorded in `supabase/applied/`)**
- `rate_limits` table + `hit_rate_limit()`: per-user counters for costly actions. Only the service
  role can call it; a user who could pass their own window could reset their own counter.
- Explicit "service role only" deny policies on the five server-only tables; the advisor's
  "RLS enabled, no policy" notices are gone.
- `product()` aggregate replaced by `split_factor()`, which pins its search path; the last
  code-fixable security warning is gone. Dry-run on live data first: all 87 positions identical,
  checksum identical before and after, `security_invoker` intact, cross-user reads still 0.
- Security advisor now shows **one** item: leaked-password protection (a dashboard toggle).
- Removed 10 junk instruments (crypto tickers stored as "US stocks" by an August import, e.g. AMP
  at $0.0004, which would have shadowed Ameriprise for the next person to add AMP). Nothing
  referenced them; portfolio checksum unchanged.

**Code (branch)**
- Rate limits on add holding / add option leg / CSV import / price refresh / put finder / split
  check / test email, sized so only a script ever meets them. Fails open if the counter is
  unreachable (logged), so the limiter can never take the app down.
- Adding a holding someone already holds no longer re-fetches its dividends and price history on
  every click (two provider calls each); the nightly sync keeps them current.
- Optional Cloudflare Turnstile CAPTCHA on sign-up, sign-in, password reset and the delete-account
  password check. Off until `NEXT_PUBLIC_TURNSTILE_SITE_KEY` is set; the CSP allows Cloudflare
  only then. Browser-tested both ways.
- `/api/health` no longer publishes the provider, call counts, run duration or raw error text.
- Next 16.3.6, React 19.3.0, Sentry 10.75, supabase-js 2.117, SnapTrade 12.2.12 (supersedes
  Dependabot #14 and #16); 0 vulnerabilities.
- Nightly sync prunes old rate-limit rows.

## QC pass 3 — accuracy, benchmark, speed (same day)

**Endpoints.** Every route re-probed on the branch build: 16 private API routes refuse without a
session or cron secret (401), 9 dashboard pages redirect to sign-in, public pages 200, unknown
paths 404. Live cron record, 30 days: sync 30/30 nights, alerts 29, digest 4 Mondays, 0 problem
runs; slowest sync 138 s of its 300 s budget.

**Sync accuracy — two bugs found and fixed.**
1. *Look-ahead in price history.* The provider's weekly bars are stamped Monday but carry the
   week's Friday close, so any date inside a week was priced up to four trading days in the
   future; the S&P 500 benchmark bought SPY at Friday's price for a Monday trade.
2. *Intraday prices stored as closes.* The 06:00 UTC sync saved "today" rows for Asian exchanges
   (mid-session) and crypto (six hours in): 1.7–2% off on average, up to 27%.
Fix: daily bars reduced to each week's last *completed* close on its real date; the nightly sync
replaces anything else in its window; existing rows repaired in production (23,785 → 22,312, one
true close per week, recorded in `supabase/applied/`). Check: portfolio value rebuilt from stored
closes matches the independent nightly snapshot to **0.03%** ($356,033 vs $356,137). Sweep: no
price moves >25% vs history, no unpriced holding, no ×100 currency-unit errors, FX fresh and in
range, no bad or duplicate dividends.

**Benchmark — brought to industry standard.**
| | Before | Now |
|---|---|---|
| Headline return | simple return on net invested | time-weighted (weekly Modified Dietz, chain-linked), annualized ≥ 1 yr |
| Your-money return | — | XIRR (money-weighted) |
| Dividends | excluded both sides | included: yours received, SPY reinvested on ex-date |
| S&P 500 series | price only, Monday-stamped weekly bars | total-return index on real week-end closes |
| Opening-balance lots | at old cost on the window's start date | at market value that day |
| Late-priced holdings (crypto) | n/a | join TWR at first close, no fake jump |
| Range picker | value change only | + time-weighted you vs S&P 500 for any window |
| SPY data | refreshed only because the owner holds SPY | maintained nightly, 10 years of dividends |

Live effect (owner portfolio, today): money-weighted **26.9%/yr** with dividends (23.8% price
only) vs **18.0%/yr** for the same money in SPY (price only; ~+1.3 pts once SPY's older dividends
load tonight). The old method would have shown +70% and "beating the market by 42%", because the
opening-balance lots carried years of earlier gains at cost. Tested against Excel's documented XIRR
example and the textbook TWR deposit case (`tests/returns.test.mjs`).

**Speed vs industry targets** (production build; mobile = 4× CPU slowdown + slow 4G, as Lighthouse):
| Metric | Target ("good") | Before | Now |
|---|---|---|---|
| Largest Contentful Paint, mobile | ≤ 2.5 s | 0.9–1.0 s; **/login 3.2 s** | **0.78–0.92 s** all pages |
| Cumulative Layout Shift | ≤ 0.1 | 0 | **0** |
| Interaction → next paint | ≤ 200 ms | 4–7 ms | **5 ms** |
| JS before a page is usable | ~170 KB budget | 298 KB | **~150 KB** (Sentry deferred) |
| Total blocking time, lab | < 200 ms | 356–453 ms | 238–353 ms (React hydration) |
| Database: holdings / options / history | < 100 ms | — | **53 / 52 / 78 ms** on ~2,000 trades |
| DB cache hit rate | > 99% | — | **99.66%** |
Fixes: `/login` server-rendered (it waited for all JavaScript); public pages stopped prefetching
the login page's 67 KB auth bundle; browser Sentry loads when idle, through a narrow import (the
namespace import had produced a 192 KB chunk; now 62 KB, errors during load still reported); the
headline font no longer reflows the hero on slow first visits. Vercel's observability data isn't
enabled on this project, so production latency percentiles weren't available; the region move
to sfo1 removes a cross-country round trip from every database call once merged.

## Pass 4 — speed to target, sign-in fix (same day)

**Speed, measured with Lighthouse itself** (v12, mobile preset: 4× CPU, slow 4G, standard
simulated throttling), production build served over HTTP/2 like Vercel serves it:

| Page | Score | First paint | Largest paint (≤ 2.5 s) | Blocking time (< 200 ms) | Layout shift (≤ 0.1) |
|---|---:|---:|---:|---:|---:|
| `/` | 98 | 0.9 s | 2.1 s | 80 ms | 0 |
| `/login` | 99 | 0.9 s | 2.3 s | 60 ms | 0 |
| `/pricing` | 99 | 0.9 s | 2.2 s | 60 ms | 0 |
| `/about` | 98 | 0.9 s | 2.2 s | 70 ms | 0 |
| `/blog` | 99 | 0.9 s | 2.2 s | 60 ms | 0 |

Cross-checked with applied throttling (the browser really slowed down rather than simulated):
largest paint 1.9–2.0 s, blocking 100–150 ms, shift 0. Pass 3's 0.8–0.9 s paint figures came from
a lighter hand-rolled harness; the table above is the standard number PageSpeed Insights reports.
Signed-in dashboard pages weren't measured: this sandbox can't reach the database.

- **Sentry now loads only when there is an error to report**, the way Sentry's own lazy loader
  works. Deferred to idle time it still cost every visit 100–190 ms of blocked main thread and a
  62 KB download. Verified: a page with no errors fetches nothing from Sentry; an error thrown
  during load, a later error and an unhandled rejection all reach Sentry. The cost: no breadcrumbs
  from before the first error.
- **The interface font no longer reflows text** on a slow first visit (0.06 shift on the pricing
  cards). Both fonts now use `display: optional`, like the headline font in pass 3.
- What remains of the blocking time is React and Next.js starting up (~110 KB compressed); nothing
  of ours is left on that path.

**Sign-in bug fixed.** The sign-in form demanded 8+ characters from the password box, so anyone
with a 6–7 character password (Supabase's own minimum is 6, and 8 isn't set there yet) was stopped
by the browser before sign-in was even tried. The rule now applies to new passwords only (sign-up
and reset), which is also how it behaves once Supabase enforces 8.

**Tried and blocked.**
- **Vercel Firewall:** the API answers "config not found" to both creating and updating it; the
  Firewall tab has to be opened once in the dashboard first. Exact settings are in step 8 below.
- **Site URL:** no change needed. `lib/site.ts` falls back to Vercel's production-domain variable,
  which switches to the custom domain by itself once one is attached, so canonical tags, the
  sitemap and social cards follow the domain without `NEXT_PUBLIC_SITE_URL`.

## Current configuration (verified live)

**Hosting — Vercel** (team "Gerald Looi's projects", **Pro**, project `portfolio`)
- Next.js 16.3.4 on Node 24.x. Production = `main@9a0c0ad`, deployment `dpl_3tx2LV7h…`, READY.
- Domains: three `*.vercel.app` only. **No custom domain.**
- Deployment Protection: Vercel Authentication on **all deployments except custom domains** →
  nobody outside the Vercel team can open the site. Attaching a custom domain makes production
  public on that domain automatically; the `*.vercel.app` URLs stay protected.
- Firewall: no custom rules configured. Password protection / trusted IPs: off.
- Functions ran in **iad1** (Washington DC) while the database is in **us-west-1** (N. California):
  every query crossed the country. This branch pins `regions: ["sfo1"]` in `vercel.json`; Vercel
  read it (the branch's deployment record shows `sfo1`), but an Ignored Build Step skips every
  non-`main` build, so the change first runs when merged.
- Crons (UTC): sync 06:00 daily · alerts 13:00 daily · digest 14:00 Mondays. `maxDuration` 300s.
- Env var names could not be listed (the Vercel connector gets 403 on environment variables, on
  both passes of this audit). Inferred from the sync record:
  `CRON_SECRET` ✅, `RESEND_API_KEY` ✅, `EMAIL_FROM` ❌ (test sender), SnapTrade ✅ (1 owner),
  provider = `yahoo`, `NEXT_PUBLIC_SITE_URL` ❌ (canonical tags point at the vercel.app URL).

**Database — Supabase** (org "My Projects", **Pro**; project "Stock Portfolio" `rkndtwhdafgeznlmpthd`)
- us-west-1, Postgres 17.6, ACTIVE_HEALTHY, 19 MB. 22 tables + 4 computed views, RLS on every table.
- 37 recorded migrations. **No drift from `schema.sql`**, checked object by object: every column
  of all 22 tables, all 18 RLS policies, every index and all 10 CHECK constraints. The only extra
  is Supabase's own `ensure_rls` event trigger, which auto-enables RLS on new tables.
- Logs (24h): no 4xx/5xx at the API edge; one few-second PostgREST reconnect at 04:08 UTC on
  Supabase's side, self-recovered.
- Keys: the legacy anon JWT and the newer `sb_publishable_` key are both enabled. Fine as is;
  moving the app to the publishable key and disabling the legacy one is optional hardening.
- Extensions: pgcrypto, uuid-ossp, pg_stat_statements, vault. pg_graphql, pg_net, pg_cron not
  installed (smaller attack surface). No storage buckets.
- Data: 1 user, 14 portfolios, 1,985 transactions, 194 option legs, 104 instruments before the fix
  pass removed 10 junk rows (76 synced
  nightly), 23,774 price-history rows, 976 dividends.
- Advisors at first pass: leaked-password protection **off** (WARN); `product()` aggregate
  search_path (WARN); 4 service-role-only tables (INFO). After the fix pass only the
  leaked-password WARN remains (a dashboard toggle). Performance advisor: unused indexes (INFO,
  expected at one user) and a fixed 10-connection Auth pool (INFO, only matters after a compute
  upgrade).

**Auth** — email/password, optional TOTP 2FA enforced in `proxy.ts` for pages and API routes;
password re-auth on account deletion; signup consent logged by trigger (verified live).
Email confirmation is **on** (verified: the owner's confirmation email was sent at signup and
clicked 9 s later). Owner account has **no 2FA enrolled**. `broker_connections` has a plaintext
`provider_user_secret` column — empty today (broker sync uses the owner's env key); encrypt it
(Supabase Vault) before per-user broker sync ships.

**Email — Resend**: API key present, but the only verified domain on the account is
`asianmall.com` (a different project). Alerts/digest can reach only the Resend account owner.

**Market data**: Yahoo (free, non-commercial terms), 583 calls/night. EODHD path is built and
tested but not switched on. Options chains are Yahoo-only.

**Observability**: Sentry (org `88aio`, project `snowfolio`) from every runtime + a cron monitor
on the nightly sync — could not be checked from here (no Sentry connector in this session).
`/api/health` live: 200, last sync 22h old, no problems. Vercel: 0 runtime errors in 7 days.

**Code — GitHub `88AIO/Portfolio`**: **public**, `main` unprotected. Open: Dependabot
[88AIO/Portfolio#14](https://github.com/88AIO/Portfolio/pull/14) and
[88AIO/Portfolio#16](https://github.com/88AIO/Portfolio/pull/16) (both CI-green; Next 16.3.6 is
out), and launch-checklist issues #1–#4.

## Pen test

Direct traffic from the audit sandbox to `*.vercel.app` and `*.supabase.co` is blocked by its
network policy, so testing used three routes: Vercel's authenticated fetch against production
(GET only), the production build run locally, and role impersonation on the live database inside
rolled-back transactions. No brute-force or load testing was run against production auth.

| Target | Attack | Result |
|---|---|---|
| Supabase REST as anonymous | read all 26 tables/views | 0 rows everywhere ✅ |
| Supabase REST as another signed-in user | read the owner's portfolios, trades, options, cash, positions, broker data | 0 rows everywhere; only shared price tables visible ✅ |
| Same | create a portfolio for the victim, write cash into theirs, rename it, delete their trades | blocked by RLS / 0 rows affected ✅ |
| Same | overwrite shared prices, inject fake stock splits, forge `sync_runs` to spoof health | blocked ✅ |
| `/api/cron/{sync,alerts,digest}`, `/api/backfill` | no token, wrong token, token prefix | 401 ✅ (constant-time compare) |
| `/api/export/*` | no session, forged cookie, path traversal | 401 ✅ |
| `/dashboard/**` + server actions | no session | redirect to `/login` ✅ |
| `/.env`, `/.git/config`, source maps | file disclosure | 404 ✅ |
| Response headers (live) | CSP, HSTS preload, X-Frame DENY, nosniff, Referrer, Permissions | all present ✅ |
| `/login?next=/%5Cevil.com` | **open redirect after sign-in** | **was exploitable → fixed** |
| "Send test email" action | mail an unconfirmed address repeatedly | **was unlimited → fixed** |
| `/api/health` | information disclosure | **was** publishing provider, call counts and raw error text → **fixed**: healthy/unhealthy and last-run time only |

## Fixed on this branch

1. **Open redirect (medium).** `safeNext` accepted `/\evil.com`; the URL parser turns `\` into `/`,
   so a crafted login link sent a freshly signed-in user to any site (a phishing relay).
   `lib/safeNext.ts` now resolves the target and requires it to stay on-site; used by the login page
   and `/auth/callback`; `tests/safe-next.test.mjs` pins it.
2. **Email abuse (medium once a domain is live).** "Send test email" had no limit and did not require
   a confirmed address, so anyone could sign up as a stranger and mail them from our domain on
   repeat — the fastest way to get a new sending domain blacklisted. Now: confirmed email only, one
   per account per 10 minutes (slot released if the send fails).
3. **Function region.** `vercel.json` pins functions to `sfo1`, next to the us-west-1 database.
   Every page load and the nightly sync make many sequential database calls; each was paying a
   cross-country round trip.

## What's left: owner-only steps, in order

Everything here needs your accounts, your money or a professional. Rough time in brackets.

1. **Merge the branch** (`claude/practical-cori-jhrop4` → `main`) [5 min]. This ships the fixes above
   and moves the servers next to the database. Dependabot #14/#16 close themselves.
2. **Buy the domain** [10 min]. snowfolio.app is available ($9.99 first year, $15/yr after) and
   matches the support address the legal pages already use. Buy it in Vercel → Domains so DNS is
   automatic, then add it to the `portfolio` project as the production domain. This alone makes
   the site public; the `*.vercel.app` URLs stay behind your login.
3. **Point auth at it** [5 min]. Supabase → Authentication → URL Configuration: Site URL
   `https://snowfolio.app`, redirect `https://snowfolio.app/auth/callback`. The site's own links
   follow the domain automatically; set `NEXT_PUBLIC_LEGAL_CONTACT_EMAIL` in Vercel only if the
   support address isn't `support@snowfolio.app`.
4. **Email** [20 min]. Resend → add domain → paste its DNS records (SPF, DKIM, DMARC) into Vercel
   DNS → verify. Vercel env `EMAIL_FROM=Snowfolio <alerts@snowfolio.app>`. Supabase →
   Authentication → SMTP: host `smtp.resend.com`, port 465, user `resend`, password = a Resend
   API key, sender `no-reply@snowfolio.app`. Without this no new user can confirm sign-up or reset
   a password.
5. **Support inbox** [10 min]: a forwarder for `support@snowfolio.app` to an inbox you read.
6. **Supabase Auth** [2 min]: Authentication → Providers → Email → leaked-password protection
   on, minimum length 8. Your own account: Settings → enable 2FA.
7. **CAPTCHA** [10 min]: Cloudflare → Turnstile → add widget for snowfolio.app → Vercel env
   `NEXT_PUBLIC_TURNSTILE_SITE_KEY` = site key → redeploy → **then** Supabase → Authentication →
   Bot and Abuse Protection → Turnstile, paste the secret key. In that order, or sign-in breaks.
8. **Vercel Firewall** [5 min]: Project → Firewall (opening it once creates the config) →
   Bot Protection: **Challenge**. Then one custom rule, action **Bypass**: path starts with
   `/api/cron/`, OR path is one of `/api/health`, `/api/backfill`, `/robots.txt`, `/sitemap.xml`,
   `/opengraph-image`, `/manifest.webmanifest`. That keeps the nightly jobs, the uptime monitor,
   search engines and link previews from being challenged. Publish.
9. **Uptime monitor** [5 min]: any free one on `https://snowfolio.app/api/health`, alert on non-200.
10. **GitHub** [5 min]: make `88AIO/Portfolio` private (history has real holdings); Settings →
    Branches → protect `main`, require the CI checks.
11. **Restore drill** [30 min]: Supabase → Database → Backups → restore the latest into a new
    scratch project; check the row counts match; delete the scratch project.
12. **Sentry** [5 min]: confirm the `nightly-sync` monitor and issue alerts email you.
13. **Legal** [professionals]: form the entity (`NEXT_PUBLIC_LEGAL_COMPANY`), attorney review of
    Terms / Privacy / Disclaimer, cyber insurance quote (issue #2).

Business decision, not a blocker for a free launch: Yahoo's terms are non-commercial. Move to
EODHD before charging (options chains need its paid add-on or another provider).

## Scale watch (no action now)

- Nightly sync: 45–81s for 76 instruments, up from 17s in August (~1s per instrument, budget 300s).
  The day-rotation budget protects it, but plan the chunked sync at **~200 distinct instruments**
  — new public users will add tickers faster than one person did.
- Supabase Pro's default compute and the computed-view design hold to low thousands of users
  (see `EFFICIENCY_AUDIT.md`). No load balancer to manage: Vercel scales functions per request.
- Yahoo is one shared free feed; the staleness gates and finder cache stop a single user from
  exhausting it, but a first 429 in `sync_runs` is the signal to move to EODHD.
