// The post-sign-in redirect target. A value that resolves off-site turns the login page into a
// phishing relay ("sign in, then land on a look-alike asking for the password again").
import "./_resolve.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";

const { safeNextPath } = await import("../lib/safeNext.ts");

test("same-site paths pass through unchanged", () => {
  for (const p of ["/dashboard", "/dashboard/options?tab=wheel", "/dashboard/holding/abc#lots", "/auth/reset"]) {
    assert.equal(safeNextPath(p), p);
  }
});

test("anything that leaves the site falls back to the dashboard", () => {
  for (const p of [
    "//evil.example",
    "https://evil.example",
    "/\\evil.example",
    "/\\/evil.example",
    "/\t/evil.example",
    "/\n/evil.example",
    "\\\\evil.example",
    "javascript:alert(1)",
    "dashboard",
    "",
  ]) {
    assert.equal(safeNextPath(p), "/dashboard", JSON.stringify(p));
  }
});

test("missing values use the fallback", () => {
  assert.equal(safeNextPath(null), "/dashboard");
  assert.equal(safeNextPath(undefined, "/login"), "/login");
});

test("a decoded query value is what gets checked", () => {
  // searchParams.get() decodes %5C to "\" before the check sees it.
  const raw = new URLSearchParams("next=/%5Cevil.example/phish").get("next");
  assert.equal(safeNextPath(raw), "/dashboard");
});
