// A batch insert/upsert to Supabase must send the same columns on every row, or PostgREST fills
// the ones a row omits with NULL — silently, across the whole batch. This is the exact mechanism
// that once turned a single DRIP row into a failed import for an entire brokerage account.
import "./_resolve.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";

const { assertUniformRowShape } = await import("../lib/supabase/rowShape.ts");

test("uniform rows pass silently", () => {
  assert.doesNotThrow(() =>
    assertUniformRowShape(
      [{ a: 1, b: true }, { a: 2, b: false }, { a: 3, b: true }],
      "test batch"
    )
  );
});

test("a single row never trips it — there's nothing to compare against", () => {
  assert.doesNotThrow(() => assertUniformRowShape([{ a: 1 }], "test batch"));
  assert.doesNotThrow(() => assertUniformRowShape([], "test batch"));
});

test("a row missing a key another row carries throws, naming the row and the key", () => {
  // The exact shape of the real incident: most rows carry `drip`, one doesn't.
  assert.throws(
    () => assertUniformRowShape([{ a: 1, drip: true }, { a: 2 }], "equity upsert"),
    /equity upsert.*row 1.*missing drip/s
  );
});

test("an extra key is caught the same way, in either direction", () => {
  assert.throws(
    () => assertUniformRowShape([{ a: 1 }, { a: 2, extra: true }], "test batch"),
    /row 1.*extra extra/s
  );
});

test("key order doesn't matter, only the set of keys", () => {
  assert.doesNotThrow(() =>
    assertUniformRowShape([{ a: 1, b: 2 }, { b: 3, a: 4 }], "test batch")
  );
});
