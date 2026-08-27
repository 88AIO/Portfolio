// The provider preflight, tested against the real module. Both failure modes it covers are silent
// in production — a bad config still renders a healthy-looking app — so the guard itself is the
// only thing standing between a mistyped env var and a dashboard that quietly stops updating.
import { test } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

// lib/marketdata/index.ts imports its providers without file extensions (TypeScript style); Node's
// resolver needs them. Same hook as scripts/verify-eodhd.mjs.
registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context);
    } catch (err) {
      if (!specifier.startsWith(".") || !context.parentURL) throw err;
      for (const ext of [".ts", ".tsx", "/index.ts"]) {
        const candidate = new URL(specifier + ext, context.parentURL);
        if (existsSync(fileURLToPath(candidate))) return { url: candidate.href, shortCircuit: true };
      }
      throw err;
    }
  },
});

const { providerConfigError, providerName } = await import("../lib/marketdata/index.ts");

function withEnv(vars, fn) {
  const saved = { ...process.env };
  try {
    for (const [k, v] of Object.entries(vars)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    return fn();
  } finally {
    process.env = saved;
  }
}

test("default (unset) is yahoo and reports no problem", () => {
  withEnv({ MARKET_DATA_PROVIDER: undefined, EODHD_API_TOKEN: undefined }, () => {
    assert.equal(providerName(), "yahoo");
    assert.equal(providerConfigError(), null);
  });
});

test("explicit yahoo needs no token", () => {
  withEnv({ MARKET_DATA_PROVIDER: "yahoo", EODHD_API_TOKEN: undefined }, () => {
    assert.equal(providerName(), "yahoo");
    assert.equal(providerConfigError(), null);
  });
});

test("eodhd with a token is a clean config", () => {
  withEnv({ MARKET_DATA_PROVIDER: "eodhd", EODHD_API_TOKEN: "t" }, () => {
    assert.equal(providerName(), "eodhd");
    assert.equal(providerConfigError(), null);
  });
});

test("eodhd without a token is FATAL — the run must abort, not write nothing quietly", () => {
  withEnv({ MARKET_DATA_PROVIDER: "eodhd", EODHD_API_TOKEN: undefined }, () => {
    const err = providerConfigError();
    assert.ok(err, "expected a config error");
    assert.equal(err.fatal, true);
    assert.match(err.message, /EODHD_API_TOKEN/);
  });
});

test("a typo falls back to yahoo and says so, without aborting the run", () => {
  withEnv({ MARKET_DATA_PROVIDER: "eodhdd", EODHD_API_TOKEN: "t" }, () => {
    // Data stays correct on the fallback, so this must not be fatal...
    const err = providerConfigError();
    assert.ok(err, "expected a config error");
    assert.equal(err.fatal, false);
    // ...but it must be unmistakable that the intended switch did not happen.
    assert.match(err.message, /NOT taken effect/);
    assert.equal(providerName(), "yahoo");
  });
});

test("case and whitespace: EODHD uppercase resolves, but a padded value does not", () => {
  withEnv({ MARKET_DATA_PROVIDER: "EODHD", EODHD_API_TOKEN: "t" }, () => {
    assert.equal(providerName(), "eodhd");
    assert.equal(providerConfigError(), null);
  });
  // Pinning current behaviour: the value is lowercased but not trimmed, so a stray space is
  // treated as a typo and caught by the fallback warning rather than silently serving yahoo.
  withEnv({ MARKET_DATA_PROVIDER: "eodhd ", EODHD_API_TOKEN: "t" }, () => {
    const err = providerConfigError();
    assert.ok(err, "a padded value should be reported, not silently accepted");
    assert.equal(err.fatal, false);
  });
});
