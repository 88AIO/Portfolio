# Snowfolio — Operational Readiness Audit (2026-09-27)

Full-stack audit of what is live today and what stands between it and a public launch: hosting,
endpoints, database, auth, crons, email, observability, repo, legal. Follows
`QC_SCORECARD_2026-09-11.md`; items that audit closed are not repeated. No domain name has been
chosen yet; everything that depends on one is grouped under "Domain day".

**Verdict:** the engine is production-grade (data isolation, crons, tests, headers all hold up
under testing). The site is **not yet usable by the public**: it has no domain, so it cannot be
reached, cannot send sign-up or password-reset emails, and names a support inbox that doesn't exist.

## Scorecard

| Area | Score | Status | Why |
|---|---:|:-:|---|
| Code quality & CI | 92 | ✅ | lint, tsc, 272/272 tests, build all green; 0 npm vulnerabilities; CI boots its own Postgres for the RLS test |
| Database & tenant isolation | 90 | ✅ | RLS on all 22 tables, views are `security_invoker`; live pen test below found no cross-user read or write |
| API endpoints & auth gates | 90 | ✅ | every private route refuses without a session / cron secret; 2 bugs found and fixed on this branch |
| Data pipeline (crons) | 90 | ✅ | 7/7 nights green, 76/76 instruments, 0 failures, 0 runtime errors in 7 days |
| Hosting & scaling (Vercel) | 75 | ⚠️ | Pro plan, auto-scaling; functions ran in the wrong region (fixed here), no firewall rules |
| Observability & alerting | 70 | ⚠️ | Sentry + cron monitor + `/api/health` + ops email; no outside uptime check possible until public |
| Auth hardening | 60 | ⚠️ | 2FA available and server-enforced; leaked-password check off, no CAPTCHA, owner has no 2FA |
| Backups & disaster recovery | 55 | ⚠️ | Supabase Pro daily backups exist; a restore has never been tested |
| Repo hygiene | 50 | ⚠️ | repo is **public** with real holdings in history; `main` is unprotected |
| Legal & compliance | 35 | ❌ | pages written; no entity, no attorney review, support inbox is on an unowned domain |
| Transactional email | 25 | ❌ | no sending domain → no `EMAIL_FROM`, no custom SMTP for sign-up/reset emails |
| Domain & public access | 15 | ❌ | no domain; every URL is behind Vercel login |
| Monetization | 15 | — | not needed for a free launch (gates unchanged, see the 09-11 scorecard) |
| **Engineering core** | **88** | | |
| **Public-launch readiness** | **58** | | 6 hard blockers below |

## Current configuration (verified live)

**Hosting — Vercel** (team "Gerald Looi's projects", **Pro**, project `portfolio`)
- Next.js 16.3.4 on Node 24.x. Production = `main@9a0c0ad`, deployment `dpl_3tx2LV7h…`, READY.
- Domains: three `*.vercel.app` only. **No custom domain.**
- Deployment Protection: Vercel Authentication on **all deployments except custom domains** →
  nobody outside the Vercel team can open the site. Attaching a custom domain makes production
  public on that domain automatically; the `*.vercel.app` URLs stay protected.
- Firewall: no custom rules configured. Password protection / trusted IPs: off.
- Functions ran in **iad1** (Washington DC) while the database is in **us-west-1** (N. California):
  every query crossed the country. This branch pins `regions: ["sfo1"]` in `vercel.json`.
- Crons (UTC): sync 06:00 daily · alerts 13:00 daily · digest 14:00 Mondays. `maxDuration` 300s.
- Env var names could not be listed (connector lacks permission). Inferred from the sync record:
  `CRON_SECRET` ✅, `RESEND_API_KEY` ✅, `EMAIL_FROM` ❌ (test sender), SnapTrade ✅ (1 owner),
  provider = `yahoo`, `NEXT_PUBLIC_SITE_URL` ❌ (canonical tags point at the vercel.app URL).

**Database — Supabase** (org "My Projects", **Pro**; project "Stock Portfolio" `rkndtwhdafgeznlmpthd`)
- us-west-1, Postgres 17.6, ACTIVE_HEALTHY, 19 MB. 22 tables + 4 computed views, RLS on every table.
- 36 recorded migrations; live objects match `schema.sql` (the only extras are Supabase's own
  `ensure_rls` event trigger, which auto-enables RLS on new tables — a good thing).
- Extensions: pgcrypto, uuid-ossp, pg_stat_statements, vault. pg_graphql, pg_net, pg_cron not
  installed (smaller attack surface). No storage buckets.
- Data: 1 user, 14 portfolios, 1,985 transactions, 194 option legs, 104 instruments (76 synced
  nightly), 23,774 price-history rows, 976 dividends.
- Advisors: leaked-password protection **off** (WARN); `product()` aggregate search_path (WARN,
  not exploitable — documented in `schema.sql`); 4 service-role-only tables (INFO, intended);
  15 unused indexes (INFO, expected at one user); Auth pool fixed at 10 connections (INFO).

**Auth** — email/password, optional TOTP 2FA enforced in `proxy.ts` for pages and API routes;
password re-auth on account deletion; signup consent logged by trigger (verified live).
Owner account has **no 2FA enrolled**.

**Email — Resend**: API key present, but the only verified domain on the account is
`asianmall.com` (a different project). Alerts/digest can reach only the Resend account owner.

**Market data**: Yahoo (free, non-commercial terms), 583 calls/night. EODHD path is built and
tested but not switched on. Options chains are Yahoo-only.

**Observability**: Sentry (org `88aio`, project `snowfolio`) from every runtime + a cron monitor
on the nightly sync — could not be checked from here (Sentry connector not authorized).
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
| `/api/health` | information disclosure | public summary shows provider, call counts, broker-owner count — low risk, trim when convenient |

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

## What's left before the public can use it

**Hard blockers** (in order — 1 unlocks most of the rest)

1. **Domain day** — buy the domain, then:
   - attach it to the Vercel project as the production domain (this alone makes the site public);
   - set `NEXT_PUBLIC_SITE_URL=https://<domain>` and `NEXT_PUBLIC_LEGAL_CONTACT_EMAIL=support@<domain>`, redeploy;
   - Supabase → Auth → URL Configuration: Site URL + `https://<domain>/auth/callback` in redirects.
2. **Sign-up and reset emails.** Supabase's built-in mailer refuses to send to anyone outside your
   Supabase team, so today **no new user could confirm their account or reset a password**. Verify
   the domain in Resend (SPF, DKIM, DMARC records), then set Supabase → Auth → SMTP to Resend, and
   set `EMAIL_FROM` in Vercel for alerts/digest.
3. **A monitored support inbox** on the new domain (privacy requests and legal notices go there).
4. **Supabase Auth hardening:** leaked-password protection on, minimum length 8, email confirmation on.
5. **Make the GitHub repo private** (history contains real holdings figures), and protect `main`
   so a red CI can't deploy.
6. **Legal minimum:** form the entity (set `NEXT_PUBLIC_LEGAL_COMPANY`), attorney review of Terms /
   Privacy / Disclaimer. (Human + professional; tracked in issue #2.)

**Before announcing it** (first week)

7. **Bot protection:** Vercel Firewall → Bot Protection on, plus a rate-limit rule on `/login` and
   POSTs to `/dashboard*`. Supabase CAPTCHA needs a small code change first (a Turnstile widget on
   the sign-up form) — enabling it without that breaks sign-up.
8. **Uptime monitor** (any free one) on `https://<domain>/api/health`, alerting on non-200.
9. **Restore drill:** restore a Supabase backup into a scratch project once and check the row counts.
10. **Owner 2FA** on your own account (you hold the broker-sync feed).
11. **Merge Dependabot #14 / #16** (Next 16.3.6, React 19.3).
12. **Sentry:** confirm alerts reach your email; optional `SENTRY_AUTH_TOKEN` for readable traces.

**Business decision, not a blocker for a free launch:** Yahoo's terms are non-commercial. Move to
EODHD before charging (options chains need its paid add-on or another provider).

## Scale watch (no action now)

- Nightly sync: 45–81s for 76 instruments, up from 17s in August (~1s per instrument, budget 300s).
  The day-rotation budget protects it, but plan the chunked sync at **~200 distinct instruments**
  — new public users will add tickers faster than one person did.
- Supabase Pro's default compute and the computed-view design hold to low thousands of users
  (see `EFFICIENCY_AUDIT.md`). No load balancer to manage: Vercel scales functions per request.
- Yahoo is one shared free feed; the staleness gates and finder cache stop a single user from
  exhausting it, but a first 429 in `sync_runs` is the signal to move to EODHD.
