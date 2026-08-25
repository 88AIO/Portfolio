# Incident Response — one-pager

**Owner:** Founder (wears every hat below) · **Last reviewed:** 2026-08-25 · **Review cadence:** quarterly + after any incident.

> Not legal advice. The notification clocks below are the *known* obligations to build around; confirm the exact triggers, thresholds, and deadlines that apply to Snowfolio with privacy counsel before you rely on them. When an incident is live, a lawyer is one of your first calls — see §5.

The nightmare for a portfolio tracker is a **cross-tenant data leak or breach** — one user seeing another's holdings, or an outsider reaching the database. This page is what to do in the first hour and the first days so you act instead of freeze.

---

## 1. Severity — decide this first (2 minutes)

| Sev | Looks like | Response |
|---|---|---|
| **SEV-1 Critical** | Confirmed unauthorized access to user data; cross-tenant leak; service-role key exposed; DB dump exfiltrated | Drop everything. Contain now (§3). Counsel + notification clocks start (§4). |
| **SEV-2 High** | Credible near-miss: RLS gap found in prod (no confirmed access yet), auth bypass, a secret committed to git | Contain within hours; investigate whether anyone actually reached data. Treat as SEV-1 the moment access is confirmed. |
| **SEV-3 Low** | Bug with no data exposure, single-account takeover via the user's own weak/reused password, spam signups | Fix on normal cadence; log it. Not a breach unless data crossed a boundary. |

When unsure between two levels, pick the higher one.

---

## 2. First 60 minutes — the checklist

1. **Timestamp it.** Note (UTC) when you were alerted and what you saw. Start an incident log — every action with a time (this becomes the evidence record).
2. **Classify severity** (§1).
3. **Preserve evidence before you change anything** — screenshot the leak, export the relevant Supabase logs (Dashboard → Logs; and `query_logs` for the API/Postgres/Auth sources), note the deployment SHA (`git rev-parse HEAD` / Vercel deployment id). Don't wipe the scene while containing it.
4. **Contain** (§3).
5. **Assess scope** — which users, which tables, how many records, what fields (holdings? balances? emails? the SnapTrade secret?). The count and the data types decide the notification duties in §4.
6. **Start the clocks** (§4) if any user data was, or may have been, accessed.

---

## 3. Containment by scenario — Snowfolio's actual stack

- **Service-role key (`SUPABASE_SERVICE_ROLE_KEY`) leaked / in a client bundle / in git**
  → Rotate it in Supabase (Project → Settings → API → roll the service_role key), update the Vercel env var, redeploy. Rotate the anon key too if implicated. Then hunt for what the old key touched in the logs.
- **RLS gap / cross-tenant leak in a table or view**
  → Take the affected read path offline fast: tighten or drop the offending policy, or set the view/table to deny-all, then redeploy. Re-run the isolation proof: `npm run test:rls` (tests/rls.test.mjs) against the fixed schema, and `get_advisors(security)`. Do not restore the path until the test is green.
- **Auth compromise / suspected account takeover**
  → In Supabase Auth, sign out the affected sessions / revoke refresh tokens; force a password reset for the user(s). If broad, revoke all sessions. Turn on leaked-password protection if it isn't already.
- **Brokerage data path (SnapTrade)**
  → It's read-only and SnapTrade holds the brokerage credentials, not us — so no trades can be placed. Still: rotate `SNAPTRADE_CONSUMER_KEY`, revoke the affected SnapTrade user(s), and notify SnapTrade (they are a processor with their own breach duties). Remember `broker_connections.provider_user_secret` is the sensitive stored value.
- **Malicious or broken deploy**
  → Roll back to the last-good deployment in Vercel (instant rollback), then fix forward.
- **Vendor breach** (Supabase / Vercel / Resend / SnapTrade / market-data)
  → Get their incident notice, assess what of ours was in scope, and fold it into your own §4 assessment — a processor breach can still be *your* notifiable event.

**Golden keys to rotate when in doubt:** `SUPABASE_SERVICE_ROLE_KEY`, Supabase anon key, `SNAPTRADE_CONSUMER_KEY`, `CRON_SECRET`, `RESEND_API_KEY`.

---

## 4. Notification clocks — start the moment access is confirmed or can't be ruled out

Confirm each against counsel; these are the defaults to plan around (verified 2026-08-25, see `docs/LAUNCH_RISK_REVIEW.md` §5).

| Who | Trigger | Deadline (confirm w/ counsel) |
|---|---|---|
| **Affected users** | Their personal data was, or likely was, accessed | "Without unreasonable delay" — most US state laws land near **30–45 days**; be prompt |
| **State AGs** (incl. California) | Breach of residents' personal info above the state threshold | Varies by state and headcount — California notably; check each affected state |
| **FTC — GLBA Safeguards Rule** | If Snowfolio is a covered "financial institution": unauthorized access to **≥ 500 consumers'** unencrypted nonpublic personal info | **30 days** after discovery |
| **Vendors/processors** | The incident touches their systems or data | Per their DPA — usually notify promptly |
| **Cyber insurer** | Any claim-worthy incident | Per policy — often a short window; call early or you can void coverage |

Write notifications in plain language: what happened, what data, what you've done, what the user should do (reset password, watch statements). Keep every notice and its send date.

---

## 5. Who to call

| Need | Contact | Where it lives |
|---|---|---|
| Legal / breach counsel | _[fill in]_ | — |
| Cyber-insurance claims line | _[fill in]_ | policy doc |
| Supabase support / security | support@supabase.com; status.supabase.com | — |
| Vercel support / status | vercel.com/help; vercel-status.com | — |
| SnapTrade support/security | _[account contact]_ | — |
| Resend | support@resend.com | — |
| User comms | `support@snowfolio.app` | app footer / legal pages |

---

## 6. After it's over

- **Post-incident note** (within ~1 week): timeline, root cause, blast radius, what fixed it, what prevents recurrence. Keep it in the evidence binder.
- **Close the hole for good** — if it was RLS, the regression test in `tests/rls.test.mjs` is the guardrail; add a case that would have caught *this* leak.
- **Update this page** with anything you learned.

---

### Pre-incident readiness (do these before you ever need the above)
- [ ] Tested backup **restore** (an untested backup is a guess) — Supabase PITR/backups verified.
- [ ] `tests/rls.test.mjs` running in CI against a staging project (secrets set).
- [ ] Supabase: leaked-password protection on; email confirmation on; `get_advisors(security)` clean.
- [ ] No secret in any client bundle (CI check); service-role key server-only.
- [ ] Cyber + tech E&O insurance bound; policy notification window noted in §5.
- [ ] `support@snowfolio.app` is a real, monitored inbox.
- [ ] Counsel + insurer names filled into §5 *now*, not during an incident.
