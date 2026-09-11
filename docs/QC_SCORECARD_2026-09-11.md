# Snowfolio — Hard QC Scorecard (2026-09-11)

Read-only audit of the whole platform (code, live Vercel project, live Supabase project, GitHub),
followed by a fix pass on branch `claude/beautiful-knuth-piliui`. Legal / entity / physical-setup
items were deliberately excluded (owner is abroad); they remain tracked in
`LAUNCH_RISK_REVIEW.md` and GitHub issues #1–#4.

Scores are 0–100 per area, **before → after** this pass. "After" assumes the branch is merged and
`supabase/schema.sql` is applied to production.

| Area | Before | After | What moved it |
|---|---:|---:|---|
| Money-math correctness | 45 | 85 | FIFO cost basis (SQL + TS twin), broker split double-count, dividend-adjusted price history, benchmark coverage guard, ex-date alerts, cushion sign, partial-assignment key, TTM/suspension dividend logic |
| Security | 70 | 88 | Security headers + CSP, MFA enforced on API routes, timing-safe cron auth, password re-auth on delete, raw broker payload dropped, confirmed-email owner gate, backfill route secret-only, CHECK constraints, RLS tests extended |
| Ops / observability | 55 | 82 | `/api/health` dead-man's switch, provider-outage detection (`quotesWritten`), sync time budget + rotation, `fetchAll` surfaces errors, snapshots paginated + per-account base currency, pruning, `OPS_ALERT_EMAIL`, top-level sync failure record + email |
| Data integrity / no lock-in | 60 | 85 | Options + cash exports, `account` and `drip` columns on the transactions export, schema CHECK constraints, unpaginated cross-user reads fixed |
| Forms / UX honesty | 55 | 85 | Validation messages actually reach users (`ActionResult`), NaN/negative/enum validation, no false "Saved.", forms never hang, duplicate-fill message |
| Website honesty & SEO | 60 | 88 | Removed unbuilt claims (ROC transparency, brokerage connect, multi-account), pricing lists alerts/digest as free (they are), About roadmap current, signup CTAs, canonical, noindex on login/reset/dashboard, sitemap dates, manifest, changelog caught up |
| Accessibility | 55 | 80 | AA contrast for quiet text, labels on every input, `role=alert`/`status`, keyboard-operable wheel rows, reduced-motion, real monospace, print styles, nav in layout (no flash), `aria-current` |
| Dependencies / CI | 65 | 92 | 0 npm-audit vulnerabilities (was 1 critical, 5 high), Next 16.3.4, `engines`, CI runs tsc with least-privilege + concurrency |
| Docs truth | 60 | 85 | HANDOFF rewritten, CLAUDE.md/README current, stale comments fixed, this scorecard |
| Monetization readiness | 15 | 15 | **Unchanged by design** — see gates below; nothing that charges money was built |
| **Overall** | **56** | **80** | |

## Live-platform facts verified during the audit
- Vercel: project on **Pro**, Node 24, no custom domain, deployment protection = Vercel SSO on
  every non-custom-domain URL (so the production site is not publicly reachable today).
- Supabase: 1 user, 14 portfolios, 1,960 transactions, 194 option legs, 76 instruments synced
  nightly, DB 19 MB. All three crons green for the last 10 days. `EMAIL_FROM` still unset
  (`emailFromIsTestAddress: true`) → alerts/digest can only ever reach the Resend account owner.
- GitHub: repository **88AIO/Portfolio is public**. Commit messages and docs contain the owner's
  real holdings figures. 8 Dependabot PRs open (the `typescript@7` one fails to build).
- **Two live wrong numbers found and fixed**: CRWD showed 0.93 shares (broker: 0.53) and VOOG 55.4
  (broker: 30.2) because reconciliation lots were sized in as-traded shares and then split-scaled
  again. The next nightly sync recomputes the lots with the fix.

## Fixed in this pass (highlights, by severity)
**Critical**
- Positions view cost basis was the lifetime average of every buy — wrong after any sell-then-rebuy,
  i.e. after one wheel cycle. Now FIFO over the lots still held; `realized_gain` exposed; TS twin
  `computeOpenPositions`; unit test + CI database test pin both.
- Broker reconciliation double-counted pre-split activity (live: CRWD, VOOG).

**High**
- `price_history` stored dividend-adjusted closes → phantom day-one loss on dividend payers and a
  total-return SPY line compared against a price-only portfolio. Now split-adjusted only
  (both providers; EODHD adjusted in the sync from `instrument_splits`).
- Benchmark silently dropped cash flows older than SPY history → flattering "beating the market".
  Comparison now hides itself with the reason.
- Ex-dividend alerts / attention items / digest fired on the **pay** date. Now the declared ex-date.
- User split overrides applied per portfolio in SQL but per user in TS → dashboard and holding page
  disagreed. SQL now user-scoped (newest entry wins, same as TS).
- Partial assignments on one series overwrote each other's share leg (dedupe key lacked date/count).
- MFA was enforced on `/dashboard` pages only; `/api/export/*` accepted a password-only session.
- No HTTP security headers at all. Now CSP, frame-ancestors none, nosniff, referrer, permissions,
  HSTS, `poweredByHeader:false`.
- Account deletion needed only a live cookie; now re-verifies the password.
- `broker_accounts.raw` persisted the provider's whole account object (full account number) into a
  client-readable table. Column dropped.
- Provider outages looked like clean nights (every method degrades to null). `quotesWritten` is
  counted; the run alerts and `/api/health` goes 503 when it is thin or stale.
- Snapshots read `positions` unpaginated and wrote USD for every account. Paginated; per-account
  base currency.
- Validation messages never reached users (Next redacts thrown server-action errors). Actions now
  return `{ok, error}`; NaN passed the old `quantity <= 0` check; upsert errors were ignored.
- Pricing page listed live free features (alerts, digest) under Pro while promising free stays free.
- Marketing claimed return-of-capital transparency, brokerage connection and multi-account rollup —
  none available to a normal signup. Reworded.

**Medium**
- Snapshot overlay flattened "net invested" at today's value (deposits read as market gains).
- Cushion sign inverted for calls; finder universe always reported "capped"; option form created
  shared instruments as bare USD stocks without lookup; cash page net summed only the latest 100.
- "Prices as of" was the fetch time; now the market's own timestamp when the provider reports it.
- Suspended dividends kept projecting; TTM window could capture five quarterly payments.
- Every "Get started" CTA landed on the sign-in form; post-login `next` was lost; callback swallowed
  expired-link errors; signup lacked `emailRedirectTo`.
- Dashboard header rendered per page (flash on navigation, inconsistent email chip). Now in layout.
- Contrast of quiet text 2.9:1 → 4.6–5.1:1. Unlabelled inputs, click-only table rows, no
  reduced-motion, `font-mono` mapped to a proportional face.
- `lib/corporate/splits.ts` contained a literal NUL byte → git treated it as binary.

## Not done — owner decisions or outside this pass
1. **Make the GitHub repository private** (outward-facing; your call). Commit history carries
   real portfolio figures.
2. **`EMAIL_FROM` + a verified sending domain in Resend** — alerts and digest are dead for anyone
   but you until then. Requires owning a domain.
3. **Custom domain + `NEXT_PUBLIC_SITE_URL`**, and decide when to relax Vercel deployment protection
   — today nobody outside your Vercel account can open the site.
4. **Supabase Auth settings**: minimum password length 8+ and leaked-password check (server-side;
   the forms now say 8), CAPTCHA on sign-in/sign-up, and add `/auth/callback` to the redirect
   allow-list (README documents it).
5. **Point an uptime monitor at `/api/health`** (free tier of any monitor).
6. **Re-run the deep price-history backfill once** after deploying (`BackfillButton` on the
   Performance page, or `/api/backfill` with the cron secret) so rows older than the nightly window
   share the new split-adjusted, dividend-unadjusted convention.
7. **Merge or close the 8 Dependabot PRs** — this branch already carries Next 16.3.4 and the minor
   bumps; the `typescript@7` and `eslint@10` majors are not adopted (the former breaks the build).
8. **Migrations folder + branch protection on `main`** before the first paying user (CI still
   auto-deploys red builds today).
9. `consent_log` cascades on account deletion — decide whether an anonymised tombstone should
   survive (legal-adjacent; left as is).
10. Sentry (or similar) — error boundaries now log the digest; nothing ships it anywhere yet.

## Monetization gates (must exist before the first paid dollar)
Nothing billing-related exists today and none of it was built here:
- Licensed market data. Yahoo's terms are non-commercial. EODHD covers every port method except
  option chains — the put finder and IV rank need a licensed options feed (EODHD's add-on, or a
  third provider behind the same port).
- `profiles.plan` (+ `stripe_customer_id`, subscription status, period end) in a service-role-only
  billing table; a `requirePro()` gate used by server actions **and** the alert/digest crons.
- A Stripe webhook route (raw body, signature check, `stripe_events` idempotency), hosted checkout,
  billing portal (one-click cancel), cancellation inside `deleteAccount`.
- Supabase Pro (daily backups) and one rehearsed restore; branch protection; a migrations folder.
- Pricing-page truth: alerts/digest are free — keep them free or gate before anyone else opts in.
