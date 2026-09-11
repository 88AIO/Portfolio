# Handoff — picking this build up in Claude Code

`CLAUDE.md` is the brief and the current state; `README.md` is the setup guide. This file is the
two-minute version of how to resume work.

## 1. Resume a session
```bash
cd path/to/snowfolio
npm install
claude
```
Claude Code reads `CLAUDE.md` automatically. Tell it what you want changed; it keeps the build green.

## 2. Run it locally
- `.env.local` from `.env.local.example` (the example documents every variable).
- `npm run dev` → http://localhost:3000. Node **20.9+** (Next 16 requires it).
- `npm test` — offline money-math suite. `npm run lint`, `npx tsc --noEmit`, `npm run build`.
- `npm run test:rls` — cross-tenant isolation against a real database (CI boots one; locally you
  need `supabase start` + `psql -f supabase/schema.sql`, or a scratch project).

## 3. Deploying a schema change
`supabase/schema.sql` is re-runnable. After changing it: run the whole file in the Supabase SQL
editor (or apply it as a migration), then re-run the security and performance advisors.

## 4. The Cowork ↔ Claude Code loop
- **Claude Code** builds, tests, deploys.
- **Cowork** captures anything from a logged-in Snowball session that isn't specced yet and drops
  it into `docs/`. Several strategy docs live only in Cowork — see the list in `CLAUDE.md`.

## 5. What's live
Everything in `CLAUDE.md` → "What already exists": auth with optional TOTP 2FA, the full dashboard
suite (overview, performance with benchmark, dividends, options cockpit + wheel + put finder, cash,
owner-only broker sync, settings), three nightly/weekly crons with a `sync_runs` record and a
`/api/health` endpoint, CSV import/export, the marketing site. Pro tier and billing are not built.
