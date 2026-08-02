# Handoff — moving the build into Claude Code

Everything you need is in this folder. Here's how to pick it up in Claude Code.

## 1. One-time setup (~5 min)
1. Install **Node.js 18+** if you don't have it: https://nodejs.org
2. Install **Claude Code**:
   ```bash
   npm install -g @anthropic-ai/claude-code
   ```
   (If the command has changed, see https://docs.claude.com/en/docs/claude-code)
3. Unzip this project somewhere permanent, then in a terminal:
   ```bash
   cd path/to/snowfolio
   git init && git add -A && git commit -m "Snowfolio starting point"
   claude
   ```
   That launches Claude Code inside the repo. It will automatically read `CLAUDE.md` and know the whole plan.

## 2. First thing to tell Claude Code
> "Read CLAUDE.md and docs/API_BLUEPRINT.md, then start Phase 1: the holdings API and full holdings screen. Keep the build green."

## 3. Before it can run, do the account setup (see README.md)
- Create the Supabase project and run `supabase/schema.sql`.
- Put your keys in `.env.local` (copy `.env.local.example`).
- Optional: EODHD token for live prices/dividends.
- `npm install && npm run dev` → http://localhost:3000

## 4. The Cowork ↔ Claude Code loop
- **Claude Code** = builds the app, runs it, deploys it.
- **Cowork** (where we've been) = logs into Snowball, captures any endpoint/screen we haven't mapped yet, does research, and drops the result into `docs/`.
- When Claude Code needs something we don't have a spec for (e.g. the diversification or benchmark endpoint), come back to Cowork, capture it live, and add it to `docs/API_BLUEPRINT.md`.

## What's already done
- Full 1:1 data model (see `supabase/schema.sql` + `docs/API_BLUEPRINT.md`)
- Auth, dashboard, holdings basics, dividend income + yield, multi-currency
- Builds/TypeScript/lint all green

## Still to capture in Cowork (when you build those features)
Diversification, performance/benchmark chart, in-app dividend calendar, backtest, rebalancing, screener — see the "Still to capture" section in `docs/API_BLUEPRINT.md`.
