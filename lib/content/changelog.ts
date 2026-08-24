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
