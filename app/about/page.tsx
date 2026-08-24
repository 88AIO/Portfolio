import Link from "next/link";
import type { Metadata } from "next";
import MarketingNav from "@/components/marketing/MarketingNav";
import MarketingFooter from "@/components/marketing/MarketingFooter";

export const metadata: Metadata = {
  title: "About — Snowfolio",
  description:
    "Why Snowfolio exists: a calm, honest place to see your whole portfolio, dividends and option premium together, built by someone who wanted it and couldn't find it.",
};

const principles: [string, string][] = [
  ["Simple by default, depth on demand", "The home screen answers what you own, what it's worth, and what income is coming. Backtests, X-ray, and deep metrics are one tap away, off by default."],
  ["Honest about its data", "Prices are timestamped. Yield ETFs show return-of-capital plainly. We'd rather show a number we can stand behind than a confident wrong one."],
  ["No duplicates", "The same holding across accounts rolls up to one line. Imports are de-duplicated, so bringing in the same file twice is always safe."],
  ["Track & inform, never advise", "We show you what's happening with your income and your options. We never tell you what to trade, and there's no trading terminal."],
  ["No ads, no upsell, no lock-in", "We don't run ads, don't sell your data, and don't cold-call. Export everything any time, or delete it all in a click."],
  ["Income first", "Most trackers treat income as a footnote. For dividend investors and options sellers, it's the whole point, so we put it front and center."],
];

export default function AboutPage() {
  return (
    <div className="bg-[#f7f4ec] text-slate-800">
      <MarketingNav />

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-[-16rem] h-[34rem] bg-[radial-gradient(52rem_32rem_at_50%_0%,rgba(32,93,74,0.10),transparent_70%)]"
        />
        <div className="relative mx-auto max-w-3xl px-6 pb-8 pt-16 text-center sm:pt-24">
          <span className="text-xs font-medium uppercase tracking-[0.14em] text-[#205d4a]">About</span>
          <h1 className="font-display mt-3 text-4xl font-medium leading-[1.08] tracking-tight text-slate-900 sm:text-5xl">
            A calm, honest home for your whole portfolio.
          </h1>
          <p className="mx-auto mt-5 max-w-xl text-lg leading-relaxed text-slate-500">
            Snowfolio started as a personal itch: a place to see dividends and option premium as one
            income picture, without the noise, and without a tracker quietly showing me stale prices.
          </p>
        </div>
      </section>

      {/* Story */}
      <section className="mx-auto max-w-2xl px-6 py-12">
        <div className="space-y-6 text-[17px] leading-relaxed text-slate-600">
          <p>
            If you invest for income, you know the frustration. Your dividends live in one app, your
            option premium in another, and neither talks to the other. The powerful tools are
            overwhelming. The simple ones show delayed prices and pretend they&apos;re live. And nearly
            all of them cap how much you can track unless you pay up.
          </p>
          <p>
            Snowfolio is the tool we wanted and couldn&apos;t find: calm on the surface, honest
            underneath, and generous by default. It counts every dollar of income once, dividends plus
            premium, shows you when each price was last updated, and never nudges you toward a trade.
          </p>
          <p>
            It&apos;s built and run by a solo maker, not a growth team. That shapes everything, from the
            quiet design to the promise that we&apos;ll never sell your data or bury the app in ads. The
            goal isn&apos;t to maximize your screen time. It&apos;s to answer one question well:{" "}
            <span className="font-medium text-slate-900">what is my portfolio actually paying me?</span>
          </p>
        </div>
      </section>

      {/* Principles */}
      <section className="bg-white/60 py-20">
        <div className="mx-auto max-w-5xl px-6">
          <div className="mx-auto max-w-2xl text-center">
            <span className="text-xs font-medium uppercase tracking-[0.14em] text-[#205d4a]">What we believe</span>
            <h2 className="font-display mt-3 text-3xl font-medium tracking-tight text-slate-900 sm:text-4xl">The principles behind every screen.</h2>
          </div>
          <div className="mt-14 grid gap-x-10 gap-y-10 md:grid-cols-2">
            {principles.map(([title, body], i) => (
              <div key={title} className="flex gap-4">
                <div className="font-display flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#edf3ee] text-sm font-medium text-[#205d4a]">
                  {String(i + 1).padStart(2, "0")}
                </div>
                <div>
                  <h3 className="text-base font-semibold text-slate-900">{title}</h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-slate-500">{body}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* What we're building */}
      <section className="mx-auto max-w-3xl px-6 py-20">
        <div className="mx-auto max-w-2xl text-center">
          <span className="text-xs font-medium uppercase tracking-[0.14em] text-[#205d4a]">Where it&apos;s going</span>
          <h2 className="font-display mt-3 text-3xl font-medium tracking-tight text-slate-900 sm:text-4xl">Built in the open, one honest step at a time.</h2>
        </div>
        <div className="mt-12 space-y-4">
          <Phase tag="Now" title="Calm holdings & income" body="A correct, honest dashboard: holdings, dividends, and option premium together, with timestamped prices and idempotent import." />
          <Phase tag="Next" title="Deeper income tools" body="A richer dividend engine and safety scoring, income alerts, and a weekly digest, packaged in a generous free tier." />
          <Phase tag="Later" title="The options-selling layer" body="A full seller's cockpit: the wheel, alerts, and an opportunity finder. Track & inform, never advise." />
        </div>
      </section>

      {/* CTA */}
      <section className="mx-auto max-w-6xl px-6 pb-20">
        <div className="overflow-hidden rounded-3xl border border-[#205d4a]/20 bg-gradient-to-br from-[#173f33] to-[#10322a] px-8 py-14 text-center shadow-[0_30px_60px_-30px_rgba(23,63,51,0.5)]">
          <h2 className="font-display text-3xl font-medium tracking-tight text-[#f7f4ec] sm:text-4xl">Come see your income clearly.</h2>
          <p className="mx-auto mt-4 max-w-lg text-lg leading-relaxed text-[#c7ddd3]">Free to start, calm by design.</p>
          <Link
            href="/login"
            className="mt-8 inline-flex items-center gap-2 rounded-full bg-[#f7f4ec] px-6 py-3 font-medium text-[#173f33] shadow-sm transition hover:bg-white"
          >
            Get started free
            <span aria-hidden>→</span>
          </Link>
        </div>
      </section>

      <MarketingFooter />
    </div>
  );
}

function Phase({ tag, title, body }: { tag: string; title: string; body: string }) {
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-6 shadow-soft sm:flex-row sm:items-center sm:gap-6">
      <span className="inline-flex w-fit shrink-0 items-center rounded-full bg-[#edf3ee] px-3 py-1 text-xs font-semibold uppercase tracking-[0.1em] text-[#205d4a]">
        {tag}
      </span>
      <div>
        <h3 className="text-base font-semibold text-slate-900">{title}</h3>
        <p className="mt-1 text-sm leading-relaxed text-slate-500">{body}</p>
      </div>
    </div>
  );
}
