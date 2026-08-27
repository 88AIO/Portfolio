// Dry run: compare the EODHD provider against Yahoo, side by side, and write NOTHING.
//
// Why this exists: switching MARKET_DATA_PROVIDER to "eodhd" changes what the nightly sync
// upserts into price_cache / price_history / dividends / instruments. Those are SHARED reference
// tables written with the service-role key — they are not scoped per environment, so a preview
// deployment running the sync writes the same rows production reads. There is no staging Supabase
// project, so "just try it in preview" is not isolated. This script is the isolated version: it
// calls both providers directly, prints a diff, and never touches the database.
//
// Run it:
//   EODHD_API_TOKEN=... node scripts/verify-eodhd.mjs
//   EODHD_API_TOKEN=... node scripts/verify-eodhd.mjs AAPL:US SCHD:US ULVR:LSE
//
// Exit code 0 = every check passed. 1 = at least one FAIL (do not switch the provider).
//
// What it is actually checking — the two ways this provider can be confidently wrong:
//   1. Minor-unit divisor. EODHD's price endpoints return no currency, so lib/marketdata/
//      providers/eodhd.ts decides the /100 from the exchange code (LSE/JSE/TA). If that guess is
//      wrong, every LSE price and dividend is 100x off. A ~100x or ~0.01x ratio vs. Yahoo is the
//      tell.
//   2. Yield scale. EODHD documents ForwardAnnualDividendYield as a fraction (0.0234) but we could
//      not verify it against a live response, so the provider guards with ">1 means already a
//      percent". This prints both providers' yields so the guess is confirmed, not assumed.

import { registerHooks } from "node:module";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

// The providers are the real .ts modules - this script must fail when they drift, not when a
// mirror of them drifts. Node 22 strips the types itself, but its ESM resolver still wants a file
// extension, and the source uses TypeScript's extensionless imports ("../normalize"). This hook
// retries a failed relative resolution with .ts/.tsx/index.ts. Nothing else about resolution
// changes.
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

const { eodhdProvider } = await import("../lib/marketdata/providers/eodhd.ts");
const { yahooProvider } = await import("../lib/marketdata/providers/yahoo.ts");

// Default set spans the risk cases: a US equity, a US dividend ETF (sector weights + dividend
// history), and an LSE name (the pence divisor).
const DEFAULT_TARGETS = ["AAPL:US", "SCHD:US", "ULVR:LSE"];
const FX_PAIRS = [
  ["EUR", "USD"],
  ["GBP", "USD"],
];

const args = process.argv.slice(2);
const targets = (args.length ? args : DEFAULT_TARGETS).map((t) => {
  const [symbol, exchange = "US"] = t.split(":");
  return { symbol, exchange };
});

if (!process.env.EODHD_API_TOKEN) {
  console.error("EODHD_API_TOKEN is not set. Export it in your shell and re-run:");
  console.error("  EODHD_API_TOKEN=your-token node scripts/verify-eodhd.mjs");
  process.exit(1);
}

const RED = "\x1b[31m";
const YEL = "\x1b[33m";
const GRN = "\x1b[32m";
const BLD = "\x1b[1m";
const OFF = "\x1b[0m";

let failures = 0;
let warnings = 0;

function fail(msg) {
  failures++;
  console.log(`   ${RED}FAIL${OFF}  ${msg}`);
}
function warn(msg) {
  warnings++;
  console.log(`   ${YEL}WARN${OFF}  ${msg}`);
}
function ok(msg) {
  console.log(`   ${GRN}ok${OFF}    ${msg}`);
}
function note(msg) {
  console.log(`   .     ${msg}`);
}

const fmt = (v) =>
  v == null ? "-" : typeof v === "number" ? (Math.abs(v) >= 1000 ? v.toFixed(0) : v.toFixed(4)) : String(v);

// Ratio-based comparison: prices move between the two vendors' snapshots, so only flag differences
// far larger than an intraday move. ~100x / ~0.01x is a divisor bug, not a price move.
function compareRatio(label, a, b, { tol = 0.05 } = {}) {
  if (a == null || b == null) {
    note(`${label}: eodhd=${fmt(a)} yahoo=${fmt(b)} (one side missing - cannot compare)`);
    return;
  }
  if (b === 0) {
    note(`${label}: yahoo returned 0, skipping ratio`);
    return;
  }
  const ratio = a / b;
  const line = `${label}: eodhd=${fmt(a)} yahoo=${fmt(b)} ratio=${ratio.toFixed(4)}`;
  if (ratio > 50 && ratio < 200) fail(`${line} - looks like a MISSING /100 (minor-unit divisor)`);
  else if (ratio > 0.005 && ratio < 0.02) fail(`${line} - looks like an EXTRA /100 (minor-unit divisor)`);
  else if (Math.abs(ratio - 1) > tol) warn(`${line} - off by more than ${(tol * 100).toFixed(0)}%`);
  else ok(line);
}

async function safe(label, fn) {
  try {
    return await fn();
  } catch (e) {
    fail(`${label} threw: ${e?.message ?? e}`);
    return null;
  }
}

console.log("EODHD vs Yahoo - dry run. Reads only; nothing is written to Supabase.\n");

for (const { symbol, exchange } of targets) {
  console.log(`${BLD}${symbol}.${exchange}${OFF}`);

  // --- quote ---------------------------------------------------------------------------------
  const [eq, yq] = await Promise.all([
    safe("eodhd.getQuote", () => eodhdProvider.getQuote(symbol, exchange)),
    safe("yahoo.getQuote", () => yahooProvider.getQuote(symbol, exchange)),
  ]);
  if (eq?.price == null) {
    fail(`quote: eodhd returned no price (bad ticker, or the plan does not cover ${exchange})`);
  }
  compareRatio("quote price", eq?.price, yq?.price);
  if (yq?.currency) {
    note(
      `currency: yahoo=${yq.currency} (eodhd's real-time endpoint returns none by design - the instrument row keeps its currency)`
    );
  }

  // --- search / metadata ---------------------------------------------------------------------
  const [em, ym] = await Promise.all([
    safe("eodhd.searchInstrument", () => eodhdProvider.searchInstrument(symbol, exchange)),
    safe("yahoo.searchInstrument", () => yahooProvider.searchInstrument(symbol, exchange)),
  ]);
  if (!em) {
    fail("search: eodhd found nothing - an added holding would get no name/currency/type");
  } else {
    note(`name:  eodhd="${em.name}" yahoo="${ym?.name ?? "-"}"`);
    if (ym?.currency && em.currency !== ym.currency) {
      fail(`currency: eodhd=${em.currency} yahoo=${ym.currency} - a mismatch mis-converts every FX total`);
    } else ok(`currency: ${em.currency}`);
    if (ym?.type && em.type !== ym.type) warn(`type: eodhd=${em.type} yahoo=${ym.type}`);
    else ok(`type: ${em.type}`);
  }

  // --- price history -------------------------------------------------------------------------
  const [eh, yh] = await Promise.all([
    safe("eodhd.getPriceHistory", () => eodhdProvider.getPriceHistory(symbol, exchange, 365)),
    safe("yahoo.getPriceHistory", () => yahooProvider.getPriceHistory(symbol, exchange, 365)),
  ]);
  if (!eh?.length) {
    fail("price history: eodhd returned 0 points - performance charts would go flat");
  } else {
    ok(
      `price history: eodhd ${eh.length} pts (${eh[0].date}..${eh[eh.length - 1].date}), yahoo ${yh?.length ?? 0} pts`
    );
    compareRatio("  latest close", eh[eh.length - 1]?.close, yh?.[yh.length - 1]?.close, { tol: 0.1 });
    // A weekly series over a year is ~52 points; a daily one is ~250 and would blow up
    // price_history row counts on every instrument.
    if (eh.length > 120) {
      fail(`price history: ${eh.length} points over 1y - that is daily, not weekly (period=w is not taking)`);
    }
  }

  // --- dividend info -------------------------------------------------------------------------
  const [ei, yi] = await Promise.all([
    safe("eodhd.getDividendInfo", () => eodhdProvider.getDividendInfo(symbol, exchange)),
    safe("yahoo.getDividendInfo", () => yahooProvider.getDividendInfo(symbol, exchange)),
  ]);
  if (!ei) {
    note("dividend info: eodhd returned none (non-payer, or fundamentals not on this plan)");
  } else {
    compareRatio("  annual per share", ei.annualDividendPerShare, yi?.annualDividendPerShare, { tol: 0.15 });
    compareRatio("  yield %", ei.yieldTtm, yi?.yieldTtm, { tol: 0.25 });
    note(`  ex-div: eodhd=${ei.exDividendDate ?? "-"} yahoo=${yi?.exDividendDate ?? "-"}`);
  }

  // --- dividend history ----------------------------------------------------------------------
  const [ed, yd] = await Promise.all([
    safe("eodhd.getDividendHistory", () => eodhdProvider.getDividendHistory(symbol, exchange)),
    safe("yahoo.getDividendHistory", () => yahooProvider.getDividendHistory(symbol, exchange)),
  ]);
  const eSum = (ed ?? []).reduce((s, r) => s + r.amount, 0);
  const ySum = (yd ?? []).reduce((s, r) => s + r.amount, 0);
  if (ed?.length) {
    ok(`dividend history: eodhd ${ed.length} rows, yahoo ${yd?.length ?? 0} rows`);
    compareRatio("  3y total per share", eSum || null, ySum || null, { tol: 0.15 });
  } else {
    note(`dividend history: eodhd 0 rows, yahoo ${yd?.length ?? 0} rows`);
    if (yd?.length) {
      fail("dividend history: yahoo has payouts and eodhd has none - the income calendar would empty out");
    }
  }

  // --- profile -------------------------------------------------------------------------------
  const [ep, yp] = await Promise.all([
    safe("eodhd.getProfile", () => eodhdProvider.getProfile(symbol, exchange)),
    safe("yahoo.getProfile", () => yahooProvider.getProfile(symbol, exchange)),
  ]);
  if (!ep) {
    note("profile: eodhd returned none");
  } else if (yp?.sector && ep.sector !== yp.sector) {
    // Sector labels must agree exactly or the dashboard splits one slice in two.
    fail(`profile sector: eodhd="${ep.sector}" yahoo="${yp.sector}" - add the mapping to lib/marketdata/normalize.ts`);
  } else {
    ok(`profile: sector=${ep.sector ?? "-"} country=${ep.country ?? "-"}`);
  }

  // --- fund breakdown ------------------------------------------------------------------------
  const [eb, yb] = await Promise.all([
    safe("eodhd.getFundBreakdown", () => eodhdProvider.getFundBreakdown(symbol, exchange)),
    safe("yahoo.getFundBreakdown", () => yahooProvider.getFundBreakdown(symbol, exchange)),
  ]);
  if (eb?.sectorWeights?.length) {
    const total = eb.sectorWeights.reduce((s, w) => s + w.weight, 0);
    // The port's contract is fractions summing to ~1. A sum near 100 means the /100 was skipped.
    if (total > 50) fail(`fund breakdown: weights sum to ${total.toFixed(2)} - those are percents, not fractions`);
    else if (total < 0.8 || total > 1.2) warn(`fund breakdown: weights sum to ${total.toFixed(3)} (expected ~1)`);
    else ok(`fund breakdown: ${eb.sectorWeights.length} sectors, sum=${total.toFixed(3)}`);
    const unknown = yb?.sectorWeights?.length
      ? eb.sectorWeights.filter((w) => !yb.sectorWeights.some((y) => y.sector === w.sector))
      : [];
    if (unknown.length) {
      warn(`fund breakdown: sector labels yahoo does not use: ${unknown.map((w) => w.sector).join(", ")} - check normalize.ts`);
    }
  } else if (yb?.sectorWeights?.length) {
    warn(`fund breakdown: yahoo has ${yb.sectorWeights.length} sectors, eodhd has none`);
  } else {
    note("fund breakdown: neither provider has one (not a fund)");
  }

  console.log("");
}

// --- FX ----------------------------------------------------------------------------------------
console.log(`${BLD}FX${OFF}`);
for (const [from, base] of FX_PAIRS) {
  const [er, yr] = await Promise.all([
    safe(`eodhd.getFxRate ${from}${base}`, () => eodhdProvider.getFxRate(from, base)),
    safe(`yahoo.getFxRate ${from}${base}`, () => yahooProvider.getFxRate(from, base)),
  ]);
  // The provider falls back to 1 when a lookup fails, which is indistinguishable from a real 1.0
  // rate - so for a non-identity pair, exactly 1 means the call failed.
  if (er === 1) fail(`${from}${base}: eodhd returned exactly 1 - that is the failure fallback, not a rate`);
  else compareRatio(`${from}${base}`, er, yr, { tol: 0.02 });
}

// --- options -----------------------------------------------------------------------------------
console.log(`\n${BLD}Options${OFF}`);
note(`eodhd capabilities.options = ${eodhdProvider.capabilities.options} (deliberate - chains are a separate paid add-on)`);
if (eodhdProvider.capabilities.options) {
  fail("capabilities.options is true but getOptionChain is not implemented against a real payload");
} else {
  ok("port degrades honestly: cockpit/wheel/put-finder stay Yahoo-only under eodhd");
}

console.log(`\n${failures} fail, ${warnings} warn. Nothing was written to the database.`);
if (failures) console.log("Do not switch MARKET_DATA_PROVIDER to eodhd until these are resolved.");
process.exit(failures ? 1 : 0);
