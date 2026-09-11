// Product changelog. Newest first. Keep entries short and user-facing: what changed and why
// it helps, not the commit-level detail.
export type Release = {
  date: string; // ISO date
  title: string;
  tag: "New" | "Improved" | "Fixed";
  points: string[];
};

export const releases: Release[] = [
  {
    date: "2026-09-11",
    title: "Cost basis you can check against your statement",
    tag: "Fixed",
    points: [
      "Cost basis and gain/loss now use first-in-first-out over the shares you still hold. After a full wheel cycle (assigned, called away, assigned again) the old average-of-every-buy printed a cost that overlapped the realized gain beside it.",
      "Total earned now includes what shares you've already sold made, and the dividends from holdings you've since closed.",
      "Broker-synced holdings that split after a visible purchase were double-counted; they now match the broker's share count.",
      "The value chart and the S&P 500 benchmark use split-adjusted, dividend-unadjusted prices — no more phantom day-one loss on dividend payers, and price return is compared with price return. The benchmark hides itself when your trades predate the S&P 500 history we hold rather than flatter you.",
      "Ex-dividend heads-ups fire on the ex-date, not the pay date. Covered-call cushion reads positive when the call is out of the money.",
      "“Prices as of” shows when the market last set the price, not when we fetched it.",
    ],
  },
  {
    date: "2026-09-11",
    title: "Clearer forms, a safer account",
    tag: "Improved",
    points: [
      "Add-holding, option and cash forms now say exactly what was wrong instead of a generic error, and never report success for a row that wasn't saved.",
      "Deleting your account asks for your password. Session-authenticated downloads respect two-factor authentication.",
      "Options and cash-ledger exports, and an account column on the transactions export, so a multi-account ledger round-trips.",
      "“Get started” lands on the sign-up form; after signing in you return to the page you asked for.",
      "Quieter text is darker for readability, tables open from the keyboard, and the app respects reduced-motion settings.",
    ],
  },
  {
    date: "2026-09-01",
    title: "Two-factor authentication",
    tag: "New",
    points: [
      "Optional authenticator-app (TOTP) two-factor sign-in, enrolled from Settings and enforced server-side on every dashboard request.",
      "The signup age and Terms attestation is now recorded with a timestamp.",
    ],
  },
  {
    date: "2026-08-31",
    title: "Stock splits, reinvested dividends, and the wheel",
    tag: "New",
    points: [
      "Stock splits are applied when reading, never by rewriting your ledger — and you can record one by hand when the data provider misses it.",
      "Mark a purchase as a reinvested dividend so it counts as shares, not as income twice.",
      "The options cockpit, the wheel view with per-stock history, IV rank, and the cash-secured put finder.",
    ],
  },
  {
    date: "2026-08-24",
    title: "A calmer, more premium look",
    tag: "Improved",
    points: [
      "A warm, editorial redesign across the whole app: quieter colors, a serif for the numbers that matter, and softer cards.",
      "Every chart now reads in one consistent palette, so the dashboard feels like a single, considered surface.",
      "A guided first-run: new accounts get a warm welcome with clear ways to add their first holding.",
    ],
  },
  {
    date: "2026-08-24",
    title: "Faster and more reactive",
    tag: "Improved",
    points: [
      "Currency conversion now reads from a cached table instead of calling out on every page load, so pages open noticeably quicker.",
      "The performance page fetches years of price history in parallel rather than one page at a time.",
      "Instant loading states when you move between pages, so navigation feels immediate.",
    ],
  },
  {
    date: "2026-08-24",
    title: "Your account, your controls",
    tag: "New",
    points: [
      "Forgot-password reset from the sign-in screen.",
      "A Settings page to export your data or delete your account and everything in it, any time.",
    ],
  },
  {
    date: "2026-08-23",
    title: "Sharper income tracking",
    tag: "Fixed",
    points: [
      "Options income now ignores orphaned expiry records, so finished-trade lists stay clean and totals stay correct.",
      "Dividend history reads in full, so the safety score and recent-payout list are always complete.",
      "Fully closed positions no longer linger as empty rows in the by-account view.",
    ],
  },
];
