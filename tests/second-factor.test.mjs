// The server-side 2FA gate (lib/auth/secondFactor.ts, used by proxy.ts). The factor list must come
// from the auth server's verified user, and the level from the validated access token — never from
// the session cookie's copy of the user, which the browser can edit.
import "./_resolve.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";

const { needsSecondFactor, tokenClaim } = await import("../lib/auth/secondFactor.ts");

const b64url = (o) => Buffer.from(JSON.stringify(o)).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const jwt = (claims) => `${b64url({ alg: "HS256" })}.${b64url(claims)}.sig`;
// The cookie's session: its `user` is whatever the browser sent — here, factors emptied by an attacker.
const client = (claims) => ({
  auth: { getSession: async () => ({ data: { session: { access_token: jwt(claims), user: { factors: [] } } } }) },
});
const enrolled = { factors: [{ status: "verified" }] };

test("an enrolled user on a password-only (aal1) session is sent to the second factor", async () => {
  // The cookie's copy of the user lists no factors (the attack); the server-verified user has one.
  assert.equal(await needsSecondFactor(client({ aal: "aal1" }), enrolled), true);
});

test("after the second factor (aal2) the gate opens", async () => {
  assert.equal(await needsSecondFactor(client({ aal: "aal2" }), enrolled), false);
});

test("no verified factor means no second step; unverified factors don't count", async () => {
  assert.equal(await needsSecondFactor(client({ aal: "aal1" }), { factors: [] }), false);
  assert.equal(await needsSecondFactor(client({ aal: "aal1" }), { factors: [{ status: "unverified" }] }), false);
  assert.equal(await needsSecondFactor(client({ aal: "aal1" }), {}), false);
});

test("fails closed on a missing session or an unreadable token", async () => {
  const none = { auth: { getSession: async () => ({ data: { session: null } }) } };
  assert.equal(await needsSecondFactor(none, enrolled), true);
  const garbage = { auth: { getSession: async () => ({ data: { session: { access_token: "not-a-jwt" } } }) } };
  assert.equal(await needsSecondFactor(garbage, enrolled), true);
});

test("tokenClaim reads base64url payloads", () => {
  assert.equal(tokenClaim(jwt({ aal: "aal2", sub: "ü?>" }), "aal"), "aal2");
  assert.equal(tokenClaim(undefined, "aal"), undefined);
});
