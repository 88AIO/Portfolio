# Snowfolio — B2C Launch Risk Review

**Prepared:** 2026-08-25 · **Product:** Snowfolio (calm portfolio + income tracker for options sellers) · **Config reviewed:** US-first web app (PWA), 18+, California governing law, solo founder, free tier now / paid "Pro" later, read-only brokerage sync via SnapTrade, no ads/tracking, no AI features shipped.

---

> ### This is not legal, tax, accounting, insurance, or security advice.
> This document spots issues and organizes them so you can act and know which professional to hand each item to. It is issue-spotting, not counsel. Nothing here creates an attorney–client or advisory relationship. Anything that will face users — Terms, Privacy Policy, Disclaimer, cancellation flows — must be reviewed by a licensed professional before you rely on it. Law and enforcement dates move; verified items are dated and sourced below, and everything not verified is marked "confirm before relying."

---

## 1. Bottom line — you can launch, with gates

**Recommendation: ship the free, tracking-only product publicly once you clear the "Before public launch" list below. It is a low-to-moderate-risk launch *as currently built* — no payments, no ads/tracking, no UGC, no AI, 18+, read-only data.** The two things that turn this from low-risk into serious risk are both *future* triggers, and both have clean gates:

1. **Charging money (Pro tier)** flips on securities-adviser exposure, subscription/auto-renewal law, sales-tax nexus, and refund duties. **Do not charge until securities counsel signs off on the "advice" posture and you have a compliant checkout + cancel flow.**
2. **A data breach or a cross-tenant data leak** is the catastrophe scenario — you hold users' entire brokerage picture. Your Supabase row-level security (RLS) is the single control standing between one user and everyone else's holdings. Treat it as load-bearing and test it like your company depends on it, because it does.

Nothing in the product as built needs to be cut to launch. The gates below are about *sequencing* and *paperwork*, not redesign.

---

## 2. Minimum Viable Launch Stack — tailored to Snowfolio

The irreducible core for *this* product. Status reflects what's already in the repo.

| # | Core item | Status in Snowfolio | Gap to close |
|---|---|---|---|
| 1 | **Terms of Service** (liability cap, warranty disclaimer, governing law/venue, dispute terms, acceptable use) | ✅ Page exists (`/legal/terms`), CA governing law | ⚠️ **Attorney review**; replace `COMPANY` placeholder with the real formed entity |
| 2 | **Privacy Policy + notice-at-collection matching real data** + working DSAR intake | ✅ Policy is accurate to actual data flows and vendors; DSAR via `support@` + in-app self-serve delete | ⚠️ Confirm `support@snowfolio.app` is a **real monitored inbox**; privacy-counsel read (financial data raises the bar) |
| 3 | **Cookie/tracking consent + Global Privacy Control (GPC)** | ✅ **Strictly-necessary cookies only, no ad/analytics trackers** — so no consent banner legally required today | 🔔 **The moment you add analytics or a pixel, this switches on** — GPC honoring + notice become required |
| 4 | **Age gate + under-13 block, logged** | ⚠️ 18+ stated in Terms/Privacy; signup has an "18 or older" attestation checkbox | ⚠️ Confirm the attestation is **logged with timestamp** (evidence); no under-13 collection path exists |
| 5 | **Payment / refund / auto-renewal disclosures + easy cancel** | ❌ Not built (Pro is "coming soon", no Stripe yet) | 🚫 **Gate: before first paying user.** Hosted Stripe checkout, clear renewal terms, one-click cancel, refund policy |
| 6 | **UGC guidelines + reporting + DMCA agent + NCII takedown** | ✅ **N/A** — no user-generated content; blog/changelog is first-party only | 🔔 Only if you add comments/community/sharing later |
| 7 | **AI disclosure + output disclaimers + kill switch** | ✅ **N/A** — no LLM/AI features shipped; the "safety score" and "put finder" are deterministic, rule-based | 🔔 Gate: before any AI feature |
| 8 | **Security baseline** (auth+MFA, secrets mgmt, encryption, dep scanning, tested backups, incident-response plan) | ◑ Partial: Supabase auth, RLS, service-role key server-only, TLS + at-rest encryption | ⚠️ **Add: MFA option, dependency scanning (Dependabot), a *tested* restore, and a written incident-response + breach-notification plan** |
| 9 | **Evidence logging from day one** (consent logs, age-gate logs, policy versions, DSAR/deletion logs) | ◑ Partial | ⚠️ Start the evidence binder now (see §6) — cheapest insurance you'll ever buy |
| 10 | **Insurance conversation** (cyber + tech E&O at minimum) | ❌ Not started | ⚠️ Get a quote before public launch; bind before first paying user |

---

## 3. Executive summary by gate

**Top critical risks (the handful that could end the company or seriously harm a user):**

- **C1 — "Are you an investment adviser?"** The dividend-safety score (0–100) and the cash-secured-put finder are *analyses of securities*. The federal test (Advisers Act §202(a)(11)) is "advice about securities, for compensation, in the business of." Today you're free (no compensation) and impersonal (not tailored to any user's goals), and the finder/score are explicitly labeled "informational only, not a recommendation." That posture likely fits the **publisher exclusion** and/or the no-compensation prong. **The risk switches on when you charge for Pro.** → securities counsel before first paying user. *(This is your #1 risk. See §4-A.)*
- **C2 — Cross-tenant data leak / breach.** You hold users' full brokerage picture. RLS is the one control preventing user A from seeing user B's holdings. A misconfigured view, a service-role key leaking client-side, or a Supabase policy gap = catastrophic. → security review of every RLS policy + service-role boundary before public launch.
- **C3 — Personal liability, no entity.** `COMPANY` is still the placeholder "Snowfolio," not a formed LLC. Until you form an entity, you are personally on the hook for everything above. → form a California LLC before public launch (certainly before first paying user).

**Before public launch (free, tracking-only):**
1. Confirm `support@snowfolio.app` is live and monitored (DSAR + legal notices land here).
2. Form the entity; put the real name in `lib/legal.ts` `COMPANY`; attorney review of Terms/Privacy/Disclaimer.
3. Security pass on RLS + service-role isolation; confirm the age attestation is logged.
4. Write a one-page incident-response + breach-notification plan; enable a tested backup restore.
5. Turn on dependency scanning; add an MFA option.
6. Start the evidence binder (consent, age-gate, policy versions, deletion logs).
7. Get a cyber + tech E&O insurance quote.

**Before first paying user (Pro):**
- Securities counsel sign-off on the "advice" posture (C1).
- Stripe hosted checkout; auto-renewal disclosure + one-click cancel (ROSCA/FTC §5 apply even though the federal Click-to-Cancel rule is currently vacated — see §4-B); refund policy.
- California sales-tax / nexus check with a CPA (SaaS taxability + your CA franchise-tax obligations).
- Bind the insurance.

**Before international expansion (actively marketing outside the US):** GDPR/UK-GDPR lawful basis + DSAR process, EU/UK representative question, transfer mechanism. *Today you passively accept foreign users with a US-processing consent notice — that's the lightweight posture; don't market abroad without counsel.*

**Delay until professional review:** anything that charges money, any AI feature, any community/UGC feature, and the securities-adviser posture. Named professionals in §7.

---

## 4. Domain deep-dives (the ones that actually bite this product)

### 4-A. Securities / investment-adviser exposure — **the signature risk for a finance app**

- **Risk:** A tool that scores dividend safety and ranks option trades could be characterized as giving investment advice, requiring SEC or state (California DFPI) investment-adviser registration.
- **Why it matters for B2C:** At consumer scale, one complaint to a state securities regulator can trigger an inquiry; unregistered-adviser findings carry fines and cease-and-desist exposure, and can void your liability protections.
- **The test (verified, current):** Under Advisers Act §202(a)(11), an "investment adviser" is someone who, **for compensation**, is **in the business of** advising others about securities. Two exits apply to you:
  - **No compensation (today):** the free tier isn't "for compensation" for advice. Lowest risk.
  - **Publisher exclusion §202(a)(11)(D):** protects "bona fide … financial publication of general and regular circulation" *when the content is impersonal — not tailored to any individual subscriber's situation.* The finder ("scans a fixed universe, ranked by annualized return-on-capital, informational only, not a recommendation") and the safety score (deterministic factors, same for everyone) are **impersonal and general** — the posture the exclusion wants. The moment you *personalize* ("given your goals, sell this put") you step outside it.
- **Applies now?** Low now (free + impersonal). **Trigger: charging for advice-like features, or personalizing recommendations.**
- **Mitigations already in place (good):** the Disclaimer explicitly states no output "— no number, chart, score, alert, benchmark, forecast —" is advice, that Snowfolio is not an RIA/broker-dealer, and "track & inform, never advise" is the product principle. Keep it that way.
- **Do:** (1) Keep every score/finder impersonal and labeled. (2) Before Pro, have **securities counsel** confirm that charging for these features preserves the exclusion (charging for an impersonal publication is generally fine; charging for personalized advice is not). (3) Never let marketing copy drift into "we tell you what to buy."
- **Priority:** Critical · **Owner:** Founder/Legal · **Review:** Attorney (securities) · **Timing:** before first paying user.

### 4-B. Payments, subscriptions, auto-renewal, tax (Pro tier)

- **Auto-renewal law — verified current status:** The FTC's federal **"Click-to-Cancel" Negative Option Rule was vacated by the Eighth Circuit on July 8, 2025** on procedural grounds and **is not in force**; the FTC sent a **new draft rulemaking (ANPRM) to OIRA on Jan 30, 2026**, so it may return. **But enforcement under ROSCA and FTC Act §5 continues, and California's own Automatic Renewal Law (ARL) is strict and independent.** *Net: build as if click-to-cancel applies* — clear renewal terms up front, affirmative consent, easy online cancel. (Sources §8.)
- **PCI scope:** Use Stripe/hosted checkout so card data never touches your servers → PCI SAQ-A (minimal). Never post card fields on your own domain.
- **Sales tax / nexus:** California may tax SaaS depending on delivery; you have CA nexus as a CA-resident founder regardless. Confirm SaaS taxability and your **CA franchise tax / LLC fee** obligations with a CPA before charging.
- **Refunds:** Publish a refund policy; app-store rules don't apply (web-only, no native apps — good).
- **Priority:** High · **Owner:** Finance/Legal · **Review:** Payment compliance + CPA · **Timing:** before first paying user.

### 4-C. Privacy & financial-data protection — **your data is unusually sensitive**

- **What you hold:** email + auth, and (if connected) read-only brokerage holdings, balances, account type, full transaction history, masked account number (last 4 only — good). This is **nonpublic personal financial information**.
- **GLBA / FTC Safeguards Rule — verified applicability:** The FTC now reads "financial institution" broadly to include fintechs doing **account aggregation / investment tools**. It's fact-dependent whether Snowfolio is itself GLBA-covered, but the **Safeguards Rule's security program requirements are the right bar to build to regardless**, and the 30-day FTC breach-notification duty (>500 consumers) is a real exposure. → treat §4-D security as mandatory, not best-effort. (Sources §8.)
- **CCPA/CPRA — verified current:** Updated CPPA regulations **took effect Jan 1, 2026 with no grace period**; 2026 enforcement is active (multi-state, multi-million-dollar settlements). New obligations bite mainly if you *sell/share* data or do automated decision-making — **you do neither**, which keeps you in the lighter tier. Statutory breach damages under CCPA's private right of action ($100–750/consumer) are the sharp edge if you *do* get breached. There's a GLBA-data carve-out in CCPA, but it's **data-level, not company-level** — your account email etc. still count. Don't over-rely on it; let privacy counsel scope it. (Sources §8.)
- **DSAR:** Self-serve delete in-app + `support@` intake covers access/delete/correct/port. Log every request and its resolution.
- **Priority:** Critical · **Owner:** Privacy/Founder · **Review:** Privacy counsel · **Timing:** before public launch.

### 4-D. Cybersecurity & technical

- **RLS is the crown jewel.** Every table with user data must be RLS-scoped by `auth.uid()`; every view (`positions`, `portfolio_totals`, `option_positions`) must be `security_invoker` so it inherits the caller's RLS rather than the definer's. **Action: write an automated test that signs in as user A and asserts a query for user B's rows returns empty — run it in CI.** This is the one test that guards C2.
- **Service-role key:** confirmed server-only in `lib/supabase/admin.ts`, never `NEXT_PUBLIC`, never imported client-side. Keep a lint/CI check that fails if `SERVICE_ROLE` appears in any client bundle.
- **Gaps to close:** MFA option for users; Dependabot/dependency scanning; a **tested** backup restore (an untested backup is a hope, not a control); a written incident-response plan with the GLBA 30-day and CCPA breach clocks noted.
- **Priority:** Critical/High · **Owner:** Engineering/Security · **Review:** Security · **Timing:** before public launch.

### 4-E. Consumer-protection / marketing honesty (FTC §5)

- Your product principles ("honest data," "prices as of…," return-of-capital transparency, no confident wrong numbers) are *exactly* the FTC-§5 posture — keep marketing claims matching reality.
- **Watch:** don't imply guaranteed income or performance; "Pro coming soon" pricing must not collect payment or imply a locked-in price you won't honor. Testimonials, if added, need FTC endorsement-guide compliance.
- **Priority:** Medium · **Owner:** Founder/Product · **Review:** Attorney (light) · **Timing:** before public launch.

### 4-F. Entity, IP, governance (solo founder)

- **Form the entity (CA LLC is the usual default) before public launch.** Until then personal liability is unlimited and the liability cap in your Terms rests on a company that doesn't exist. Put the real name in `COMPANY`.
- **IP:** as sole author you own the code, but a signed founder IP-assignment to the entity (once formed) keeps it clean for any future investment/sale.
- **CA franchise tax:** an LLC owes the $800 minimum annual franchise tax + the gross-receipts LLC fee — budget for it; don't form out-of-state to dodge it (a CA-resident founder still owes CA).
- **Priority:** High · **Owner:** Founder/Legal/Finance · **Review:** Attorney + CPA · **Timing:** before public launch / before first paying user.

### 4-G. Domains that are N/A today (documented so you know the trigger)

| Domain | Status | Switches on when… |
|---|---|---|
| Teen safety (13–17) | **N/A** — 18+ product, no teen features | never, unless you drop the age floor |
| UGC / moderation / DMCA / NCII | **N/A** — no user content; blog is first-party | you add comments, sharing, community, or profiles |
| AI governance | **N/A** — no AI features | you add any LLM/AI feature (then: disclosure, output disclaimer, abuse limits, kill switch, vendor retention terms) |
| Cookie-consent banner / GPC | **N/A** — strictly-necessary cookies only | you add analytics, a pixel, or any non-essential cookie |
| CFPB §1033 open-banking rule | **Not in force** — enjoined & under CFPB reconsideration in 2026 | doesn't obligate you now; monitor. You rely on SnapTrade, which handles the aggregation contracts (Sources §8) |
| International (GDPR/UK/DSA/Quebec) | **Lightweight** — passive foreign access w/ US-processing notice | you actively market or target the EU/UK/Canada |

---

## 5. Verified anchor-law status (as of 2026-08-25)

Each item below was confirmed by web search against reputable law-firm / regulator / court sources on the review date. Everything not listed here is **status not independently verified — confirm before relying.**

| Anchor | Current status (verified) | Relevance to you |
|---|---|---|
| **Investment Advisers Act §202(a)(11)** + publisher exclusion | In force; exclusion protects *impersonal, general-circulation* financial analysis, not personalized advice | Core to C1 — keep features impersonal; counsel before charging |
| **FTC "Click-to-Cancel" / Negative Option Rule** | **Vacated by 8th Cir. Jul 8, 2025; not in force.** FTC restarted rulemaking (ANPRM to OIRA Jan 30, 2026). ROSCA + FTC §5 enforcement continues | Build compliant cancel flow anyway (ROSCA + CA ARL) before charging |
| **CCPA/CPRA + 2026 CPPA regulations** | Updated regs **effective Jan 1, 2026, no grace period**; active multi-state enforcement in 2026 | You're in the lighter tier (no sell/share); breach private-right-of-action is the sharp edge |
| **GLBA / FTC Safeguards Rule** | In force; FTC reads "financial institution" broadly to reach account-aggregation fintechs; 30-day breach notice for >500 consumers | Build to Safeguards bar regardless of exact coverage |
| **CFPB §1033 Personal Financial Data Rights** | **Enjoined; compliance stayed; CFPB reconsidering/rewriting (ANPR Aug 22, 2025)** | No obligation now; monitor; SnapTrade carries the aggregation relationship |

---

## 6. The evidence binder — start these logs on day one

Cheapest insurance there is. Keep, versioned:
- **Consent & age-gate log** — timestamped record of each signup's Terms/Privacy agreement + 18+ attestation.
- **Policy version history** — every version of Terms/Privacy/Disclaimer with effective dates (git already does this — just tag releases).
- **DSAR / deletion log** — who asked what, when, and how you resolved it.
- **Access & security events** — auth logs, admin/service-role actions, backup-restore test results.
- **Vendor register** — Supabase, Vercel, SnapTrade, Resend, market-data providers: what each processes, their DPA/terms, breach-notice contacts.
- **Incident-response plan** — one page: who does what, the GLBA 30-day and CCPA notification clocks, regulator contacts.

---

## 7. Who to hand what to

| Item | Professional |
|---|---|
| Terms / Privacy / Disclaimer final review; entity formation; IP assignment | **California business + securities attorney** |
| "Are we an investment adviser once we charge?" | **Securities attorney** (SEC/DFPI) |
| CCPA/CPRA scope, GLBA carve-out, DSAR process, breach plan | **Privacy counsel** |
| RLS/service-role audit, pen-test, incident-response | **Security reviewer** |
| CA franchise tax, LLC fee, SaaS sales-tax nexus | **CPA (California)** |
| Cyber + tech E&O (and media liability if you ever add UGC) | **Insurance broker** |
| Stripe/auto-renewal/ROSCA/CA ARL compliance | **Payments-savvy attorney** |

---

## 8. What changed recently / monitor

- **Click-to-Cancel** federal rule is **dead for now but coming back** — watch the FTC's 2026 rulemaking; build the compliant flow regardless (CA ARL + ROSCA don't care about the federal vacatur).
- **CFPB §1033 open banking** is **enjoined and being rewritten** — the shape of consumer financial-data-access rights is genuinely unsettled. *This area is changing; do not rely on it without current professional review.*
- **CCPA 2026 regs** are live with no grace period and enforcement is aggressive — revisit if you ever add analytics, ad pixels, or automated decision-making.
- **GLBA "financial institution" scope** keeps expanding toward fintechs — reassess your coverage with counsel once you have real users and (especially) once you charge.

---

### Sources (verified 2026-08-25)
- Investment Advisers Act / publisher exclusion — Winstead Investment Management; Interactive Brokers spotlight PDF; Terms.Law no-action-letter guide.
- FTC Click-to-Cancel vacatur & 2026 rulemaking — Gibson Dunn; Latham & Watkins; Sidley Austin; Crowell & Moring.
- CCPA/CPRA 2026 regs & enforcement — BDO; Koley Jessen; Richt Law Firm; PrivacyLawMap.
- GLBA Safeguards Rule / fintech scope — Cooley (cdp.cooley.com); Fingerprint; McDermott.
- CFPB §1033 status — Cozen O'Connor; Consumer Financial Services Law Monitor; Holland & Knight; PYMNTS.

*Sources are law-firm client alerts and regulator/court summaries used to date-check status; they are not a substitute for advice from your own counsel.*
