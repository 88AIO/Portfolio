// Blog content. Posts are plain data so there's no MDX toolchain to maintain; the blog pages
// render these blocks. Newest first.
export type Block =
  | { type: "p"; text: string }
  | { type: "h2"; text: string }
  | { type: "ul"; items: string[] }
  | { type: "quote"; text: string };

export type Post = {
  slug: string;
  title: string;
  excerpt: string;
  date: string; // ISO date
  readMins: number;
  tag: string;
  body: Block[];
};

export const posts: Post[] = [
  {
    slug: "your-option-premium-is-income",
    title: "Your option premium is income. Start counting it.",
    excerpt:
      "If you sell covered calls or cash-secured puts, that premium is real money you earned. Here's why most trackers miss it, and how we count it.",
    date: "2026-08-24",
    readMins: 4,
    tag: "Income",
    body: [
      { type: "p", text: "Ask most portfolio trackers what your investments pay you, and they'll show you dividends. That's half the picture. If you sell options for income, the premium you collect is real cash, and it belongs in the same conversation as your dividends." },
      { type: "h2", text: "Two incomes, one number" },
      { type: "p", text: "A covered call or a cash-secured put pays you upfront. Over a year, that premium can rival or exceed the dividends on the same shares. Yet it usually lives in a brokerage statement, a spreadsheet, or nowhere, disconnected from the rest of your income." },
      { type: "p", text: "Snowfolio puts both in one place and adds them up: dividends received plus net option premium, counted exactly once. The premium is credited when you sell, debited if you buy to close or roll, and fees are always a cost. No double-counting, no premium quietly folded into your cost basis where you'll forget it." },
      { type: "h2", text: "Why counting it once matters" },
      { type: "p", text: "It's tempting to think of premium as lowering your cost basis. That's a fair mental model, but if you also count it as income, you've counted the same dollar twice. We keep premium as income, and separately show how much of it, on shares you still hold, has effectively shaved off what those shares cost you. One dollar, one place." },
      { type: "quote", text: "The question we care about is simple: what is your portfolio actually paying you? Premium is a big part of the answer." },
      { type: "h2", text: "Track and inform, never advise" },
      { type: "p", text: "Seeing your premium clearly is not the same as being told what to trade. Snowfolio tracks and informs. It shows what's expiring, what might get assigned, and how your income is building. It never recommends a trade, and there's no terminal shouting at you. Calm by default, honest about the numbers." },
    ],
  },
  {
    slug: "prices-as-of",
    title: "“Prices as of”: why every number here has a timestamp",
    excerpt:
      "Delayed prices dressed up as live numbers are the quiet lie in most trackers. We'd rather show you when a price was last updated.",
    date: "2026-08-23",
    readMins: 3,
    tag: "Honest data",
    body: [
      { type: "p", text: "The most common complaint about portfolio trackers isn't a missing feature. It's trust. A number sits there looking authoritative, and you have no idea whether it's from this minute or last Tuesday." },
      { type: "h2", text: "Delayed is fine. Pretending isn't." },
      { type: "p", text: "Free and low-cost market data is often delayed, and that's usually fine for tracking a long-term portfolio. What isn't fine is presenting a delayed number as if it were live. So everywhere a price appears in Snowfolio, you can see when it was last updated. “Prices as of two hours ago” is more useful than a confident wrong number." },
      { type: "h2", text: "Honest about the hard cases" },
      { type: "p", text: "Some holdings need extra honesty. High-yield ETFs can pay out capital as well as income; we show that plainly rather than flattering the yield. Holdings with too little dividend history stay unrated on our safety score instead of getting a made-up grade. When we don't know something, we say so." },
      { type: "quote", text: "We would rather show a number we can stand behind than a confident wrong one." },
      { type: "p", text: "It's a small principle with a big effect: you can act on what you see, because you know exactly how fresh it is." },
    ],
  },
  {
    slug: "the-case-for-calm",
    title: "The quiet case for a calm portfolio tracker",
    excerpt:
      "The powerful trackers overwhelm; the simple ones cut corners. There's a seat in the middle, and it's where we sit.",
    date: "2026-08-22",
    readMins: 3,
    tag: "Philosophy",
    body: [
      { type: "p", text: "Portfolio tools tend to land at one of two extremes. The powerful ones bury you in tabs, metrics, and settings until checking your holdings feels like a job. The simple ones are pleasant but thin, and often dishonest about their data. Neither serves someone who just wants a clear, trustworthy read on what they own and what it earns." },
      { type: "h2", text: "Simple by default, depth on demand" },
      { type: "p", text: "The home screen should answer three questions: what do I own, what's it worth, and what income is coming. That's it. Backtests, x-rays, and deep metrics are one tap away, off by default, for the moments you actually want them." },
      { type: "h2", text: "No ads, no upsell, no lock-in" },
      { type: "ul", items: [
        "No ads, ever, and we don't sell your data.",
        "A genuinely generous free tier, with no cap on how much you can track.",
        "Your data exports cleanly and round-trips back in, so you're never stuck.",
      ] },
      { type: "p", text: "None of this is flashy. That's the point. A calm tool you can trust, that answers one question well, is worth more than a dashboard you dread opening." },
    ],
  },
];

export function getPost(slug: string): Post | undefined {
  return posts.find((p) => p.slug === slug);
}

export function formatDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}
