// Cross-tenant RLS isolation test.
//
// The single most important security property in Snowfolio: one signed-in user
// must NEVER be able to read (or write) another user's data. That guarantee lives
// entirely in Supabase row-level security (RLS) — a misconfigured policy or a view
// that isn't `security_invoker` would silently leak every holding. This test proves
// the guarantee against a real Postgres/PostgREST instance (RLS can't be tested with
// mocks) by provisioning two throwaway users, seeding each, and asserting neither can
// see the other across every user-scoped table AND the computed views.
//
// Runs with zero extra dependencies: Node's built-in test runner + @supabase/supabase-js
// (already a project dependency).
//
//   npm run test:rls        # needs the three env vars below
//
// It SKIPS cleanly when the env isn't set, so local dev and forks without secrets
// stay green; CI supplies the secrets and runs it for real. Point it at a staging
// Supabase project when you can — it creates and deletes real auth users each run
// (uniquely named and cleaned up in teardown, so running against prod is safe but noisy).

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const haveCreds = Boolean(URL && ANON && SERVICE);

const skip = haveCreds
  ? false
  : "set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY to run";

// A service-role admin client bypasses RLS — used only to seed and tear down fixtures.
function admin() {
  return createClient(URL, SERVICE, { auth: { persistSession: false } });
}

// A fresh anon client signed in as one user — every query carries that user's JWT,
// so RLS applies exactly as it would in the browser / server components.
async function signInAs(email, password) {
  const c = createClient(URL, ANON, { auth: { persistSession: false } });
  const { error } = await c.auth.signInWithPassword({ email, password });
  assert.equal(error, null, `sign-in failed for ${email}: ${error?.message}`);
  return c;
}

describe("RLS cross-tenant isolation", { skip }, () => {
  const db = haveCreds ? admin() : null;
  const suffix = randomUUID().slice(0, 8);

  // Two tenants. `A` is the "attacker" whose queries must never surface `B`'s rows.
  const A = { email: `rls-a-${suffix}@example.com`, password: randomUUID(), id: null, portfolioId: null };
  const B = { email: `rls-b-${suffix}@example.com`, password: randomUUID(), id: null, portfolioId: null };
  let instrumentId = null;   // referenced by BOTH users
  let instrumentBId = null;  // referenced ONLY by user B — A must not be able to read it
  let clientA = null;
  let clientB = null;

  before(async () => {
    // --- users (email pre-confirmed so password sign-in works immediately) ---
    for (const u of [A, B]) {
      const { data, error } = await db.auth.admin.createUser({
        email: u.email,
        password: u.password,
        email_confirm: true,
      });
      assert.equal(error, null, `createUser(${u.email}): ${error?.message}`);
      u.id = data.user.id;
    }

    // --- one shared reference instrument (needed for transactions/options) ---
    {
      const { data, error } = await db
        .from("instruments")
        .insert({ symbol: `RLS${suffix}`, exchange: "US", name: "RLS Test Instrument", currency: "USD" })
        .select("id")
        .single();
      assert.equal(error, null, `seed instrument: ${error?.message}`);
      instrumentId = data.id;
    }

    // --- per-user fixtures across the user-scoped tables ---
    for (const u of [A, B]) {
      const { data: p, error: pe } = await db
        .from("portfolios")
        .insert({ user_id: u.id, name: `Portfolio ${u.email}` })
        .select("id")
        .single();
      assert.equal(pe, null, `seed portfolio: ${pe?.message}`);
      u.portfolioId = p.id;

      const seed = await Promise.all([
        db.from("transactions").insert({
          portfolio_id: p.id, instrument_id: instrumentId,
          type: "buy", quantity: 10, price: 100, currency: "USD",
        }),
        db.from("cash_ledger").insert({
          portfolio_id: p.id, description: "seed", amount: 1000, currency: "USD",
        }),
        db.from("option_transactions").insert({
          portfolio_id: p.id, instrument_id: instrumentId,
          action: "sell_to_open", option_type: "put",
          strike: 90, expiration: "2099-01-15", contracts: 1, premium: 1.25, currency: "USD",
        }),
        // A user's own corporate-action correction. It restates share counts and cost basis, so
        // leaking or cross-writing one would silently rewrite another tenant's portfolio.
        db.from("portfolio_splits").insert({
          portfolio_id: p.id, instrument_id: instrumentId,
          ex_date: "2024-06-10", ratio: 2,
        }),
      ]);
      for (const r of seed) assert.equal(r.error, null, `seed row: ${r.error?.message}`);
    }

    // An instrument that ONLY user B references — used to prove the tightened instruments policy:
    // A must not be able to read a ticker/name it has no holding in.
    {
      const { data, error } = await db
        .from("instruments")
        .insert({ symbol: `RLSB${suffix}`, exchange: "US", name: "RLS B-only Instrument", currency: "USD" })
        .select("id")
        .single();
      assert.equal(error, null, `seed B-only instrument: ${error?.message}`);
      instrumentBId = data.id;
      const { error: te } = await db.from("transactions").insert({
        portfolio_id: B.portfolioId, instrument_id: instrumentBId,
        type: "buy", quantity: 5, price: 50, currency: "USD",
      });
      assert.equal(te, null, `seed B-only transaction: ${te?.message}`);
    }

    // A secret that only the service role should ever touch — owned by B.
    {
      const { error } = await db.from("broker_connections").insert({
        user_id: B.id, provider: "snaptrade",
        provider_user_id: `pu-${suffix}`, provider_user_secret: "TOP-SECRET",
      });
      assert.equal(error, null, `seed broker_connection: ${error?.message}`);
    }

    clientA = await signInAs(A.email, A.password);
    clientB = await signInAs(B.email, B.password);
  });

  after(async () => {
    if (!db) return;
    // Deleting the users cascades to portfolios -> transactions/options/cash/connections.
    try {
      if (A.id) await db.auth.admin.deleteUser(A.id);
      if (B.id) await db.auth.admin.deleteUser(B.id);
      if (instrumentId) await db.from("instruments").delete().eq("id", instrumentId);
      if (instrumentBId) await db.from("instruments").delete().eq("id", instrumentBId);
    } catch {
      // Best-effort cleanup; a leaked test user is uniquely named and harmless.
    }
  });

  // Helper: assert a table, read as `client`, never exposes `foreignPortfolioId`,
  // and (sanity) does expose `ownPortfolioId` so we know the fixture really landed.
  async function assertScoped(client, table, ownPortfolioId, foreignPortfolioId) {
    const { data, error } = await client.from(table).select("portfolio_id");
    assert.equal(error, null, `${table} read errored: ${error?.message}`);
    const ids = (data ?? []).map((r) => r.portfolio_id);
    assert.ok(!ids.includes(foreignPortfolioId), `${table} leaked another tenant's rows`);
    assert.ok(ids.includes(ownPortfolioId), `${table} did not return the reader's own rows (fixture missing?)`);
  }

  it("portfolios: a user sees only their own", async () => {
    const { data, error } = await clientA.from("portfolios").select("id,user_id");
    assert.equal(error, null);
    assert.ok((data ?? []).length > 0, "A should see its own portfolio");
    assert.ok(data.every((r) => r.user_id === A.id), "portfolios leaked another user_id");
    assert.ok(!data.some((r) => r.id === B.portfolioId), "portfolios exposed B's portfolio to A");
  });

  it("transactions: a user cannot see another tenant's rows", () =>
    assertScoped(clientA, "transactions", A.portfolioId, B.portfolioId));

  it("cash_ledger: a user cannot see another tenant's rows", () =>
    assertScoped(clientA, "cash_ledger", A.portfolioId, B.portfolioId));

  it("option_transactions: a user cannot see another tenant's rows", () =>
    assertScoped(clientA, "option_transactions", A.portfolioId, B.portfolioId));

  it("portfolio_splits: a user cannot see another tenant's corporate actions", () =>
    assertScoped(clientA, "portfolio_splits", A.portfolioId, B.portfolioId));

  // The computed views are the subtle risk: if any weren't `security_invoker`, they'd
  // run with the definer's rights and bypass RLS entirely.
  it("positions view: does not leak another tenant's holdings", () =>
    assertScoped(clientA, "positions", A.portfolioId, B.portfolioId));

  it("option_positions view: does not leak another tenant's options", () =>
    assertScoped(clientA, "option_positions", A.portfolioId, B.portfolioId));

  it("portfolio_totals view: does not leak another tenant's totals", () =>
    assertScoped(clientA, "portfolio_totals", A.portfolioId, B.portfolioId));

  it("positions_all view: does not leak another tenant's closed holdings either", () =>
    assertScoped(clientA, "positions_all", A.portfolioId, B.portfolioId));

  // Not an isolation test, but the one place the SQL view's money math runs against a real
  // Postgres in CI. Its twin is tests/open-positions.test.mjs (lib/tax/realized.ts); the numbers
  // here must match those there.
  it("positions view: cost basis is FIFO over the lots still held, in today's shares", async () => {
    const mk = async (tag) => {
      const r = await db
        .from("instruments")
        .insert({ symbol: `${tag}${suffix}`, exchange: "US", name: `${tag} Test`, currency: "USD" })
        .select("id")
        .single();
      assert.equal(r.error, null, `seed ${tag} instrument: ${r.error?.message}`);
      return r.data.id;
    };
    const iid = await mk("RLSF");
    const sid = await mk("RLSS");
    // Assigned 100 @ 50, called away @ 55, assigned again 100 @ 52 — the wheel seller's basic cycle.
    // And, on a second instrument, a buy of 10 @ 100 BEFORE a 2-for-1 split the user entered
    // themselves: only splits strictly after the trade date apply, so the date matters.
    const seed = await db.from("transactions").insert([
      { portfolio_id: A.portfolioId, instrument_id: iid, type: "buy", quantity: 100, price: 50, currency: "USD", executed_at: "2024-01-10", dedupe_key: `f1-${suffix}` },
      { portfolio_id: A.portfolioId, instrument_id: iid, type: "sell", quantity: 100, price: 55, currency: "USD", executed_at: "2024-06-10", dedupe_key: `f2-${suffix}` },
      { portfolio_id: A.portfolioId, instrument_id: iid, type: "buy", quantity: 100, price: 52, currency: "USD", executed_at: "2025-01-10", dedupe_key: `f3-${suffix}` },
      { portfolio_id: A.portfolioId, instrument_id: sid, type: "buy", quantity: 10, price: 100, currency: "USD", executed_at: "2024-01-10", dedupe_key: `s1-${suffix}` },
    ]);
    assert.equal(seed.error, null, `seed fifo rows: ${seed.error?.message}`);
    const ov = await db.from("portfolio_splits").insert({ portfolio_id: A.portfolioId, instrument_id: sid, ex_date: "2024-06-10", ratio: 2 });
    assert.equal(ov.error, null, `seed split override: ${ov.error?.message}`);
    try {
      const { data, error } = await clientA
        .from("positions").select("shares, avg_cost, cost_basis, realized_gain").eq("instrument_id", iid).single();
      assert.equal(error, null, `read positions: ${error?.message}`);
      assert.equal(Number(data.shares), 100);
      assert.equal(Number(data.avg_cost), 52, "only the second lot is still held");
      assert.equal(Number(data.cost_basis), 5200);
      assert.equal(Number(data.realized_gain), 500, "the first lot's gain, once");

      // 10 bought pre-split → 20 of today's shares at $50; money never scales.
      const { data: split, error: splitErr } = await clientA
        .from("positions").select("shares, avg_cost, cost_basis").eq("instrument_id", sid).single();
      assert.equal(splitErr, null, `read split position: ${splitErr?.message}`);
      assert.equal(Number(split.shares), 20);
      assert.equal(Number(split.avg_cost), 50);
      assert.equal(Number(split.cost_basis), 1000);
    } finally {
      await db.from("portfolio_splits").delete().eq("instrument_id", sid);
      await db.from("transactions").in("instrument_id", [iid, sid]).delete();
      await db.from("instruments").delete().in("id", [iid, sid]);
    }
  });

  it("isolation is symmetric (B cannot see A either)", () =>
    assertScoped(clientB, "positions", B.portfolioId, A.portfolioId));

  it("instruments: a user can read a reference row it actually holds", async () => {
    const { data, error } = await clientA.from("instruments").select("id").eq("id", instrumentId);
    assert.equal(error, null);
    assert.equal((data ?? []).length, 1, "A should be able to read an instrument it holds");
  });

  it("instruments: a user cannot read a reference row only another tenant holds", async () => {
    // Enumerate: B's exclusive instrument must not appear in A's instruments list.
    const list = await clientA.from("instruments").select("id");
    assert.equal(list.error, null);
    assert.ok(
      !(list.data ?? []).some((r) => r.id === instrumentBId),
      "instruments leaked a ticker only another tenant holds",
    );
    // Direct lookup by id must also come back empty.
    const byId = await clientA.from("instruments").select("id").eq("id", instrumentBId);
    assert.equal(byId.error, null);
    assert.equal((byId.data ?? []).length, 0, "A read another tenant's instrument by id");
  });

  it("broker_connections (service-role only): authenticated read returns nothing", async () => {
    const { data, error } = await clientA.from("broker_connections").select("id");
    // RLS with no client policy -> empty result set (never another user's secret), no rows either way.
    assert.equal(error, null, "broker_connections read should not error, just return empty");
    assert.equal((data ?? []).length, 0, "broker_connections must never be client-readable");
  });

  it("write guard: a user cannot create a row owned by someone else", async () => {
    const { error } = await clientA
      .from("portfolios")
      .insert({ user_id: B.id, name: "spoofed" });
    assert.notEqual(error, null, "RLS with-check must reject inserting a portfolio owned by another user");
  });

  it("write guard: a user cannot update or delete another tenant's row by id", async () => {
    const { data: bRow } = await db
      .from("transactions").select("id, quantity").eq("portfolio_id", B.portfolioId).limit(1).single();
    // UPDATE by a guessed id: RLS makes the row invisible, so zero rows change and no error leaks
    // whether the id exists.
    const upd = await clientA.from("transactions").update({ quantity: 999 }).eq("id", bRow.id).select("id");
    assert.equal(upd.error, null);
    assert.equal((upd.data ?? []).length, 0, "A updated a row it cannot see");
    const del = await clientA.from("transactions").delete().eq("id", bRow.id).select("id");
    assert.equal(del.error, null);
    assert.equal((del.data ?? []).length, 0, "A deleted a row it cannot see");
    const { data: still } = await db.from("transactions").select("quantity").eq("id", bRow.id).single();
    assert.equal(Number(still.quantity), Number(bRow.quantity), "B's row must be untouched");
  });

  it("shared reference tables are read-only for signed-in users", async () => {
    // price_cache, dividends and instrument_splits are written by the service role only. A client
    // that could write them would restate every other user's prices or cost basis.
    const price = await clientA.from("price_cache").upsert({ instrument_id: instrumentId, price: 1, currency: "USD" });
    assert.notEqual(price.error, null, "authenticated write to price_cache must be rejected");
    const split = await clientA.from("instrument_splits").insert({ instrument_id: instrumentId, ex_date: "2020-01-01", ratio: 10 });
    assert.notEqual(split.error, null, "authenticated write to instrument_splits must be rejected");
    const div = await clientA.from("dividends").insert({ instrument_id: instrumentId, ex_date: "2020-01-01", amount: 1 });
    assert.notEqual(div.error, null, "authenticated write to dividends must be rejected");
  });

  it("signed-out (anon) reads return nothing from every user table and view", async () => {
    const anon = createClient(URL, ANON, { auth: { persistSession: false } });
    for (const table of ["portfolios", "transactions", "option_transactions", "positions", "positions_all", "option_positions", "portfolio_value_history", "notification_prefs", "broker_accounts", "consent_log", "instruments"]) {
      const { data, error } = await anon.from(table).select("*").limit(5);
      assert.equal(error, null, `${table}: anon read errored: ${error?.message}`);
      assert.equal((data ?? []).length, 0, `${table}: anon read returned rows`);
    }
  });
});
