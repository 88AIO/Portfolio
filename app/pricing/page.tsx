import Link from "next/link";
import type { Metadata } from "next";
import MarketingNav from "@/components/marketing/MarketingNav";
import MarketingFooter from "@/components/marketing/MarketingFooter";

export const metadata: Metadata = {
  title: "Pricing — Snowfolio",
  description:
    "Start free with no holding cap. A generous free tier for your whole portfolio, dividends, and option income, with a Pro tier for deeper analytics coming later. No ads, no upsell.",
};

const freeIncludes = [
  "Your whole portfolio, no holding cap",
  "Dividends + option premium in one income view",
  "Dividend calendar & 0–100 safety score",
  "Options-seller cockpit (the wheel, premium over time)",
  "Performance with S&P 500 benchmark",
  "US & international, multi-account rollup",
  "Realized gains (FIFO), short vs. long term",
  "CSV import/export, no lock-in",
  "Nightly price & dividend refresh",
];

const proIncludes = [
  "Everything in Free",
  "Advanced analytics & backtesting",
  "Email alerts: assignment, expiry, ex-dividend",
  "Weekly income digest",
  "Rebalancing tools",
  "Priority support",
];

export default function PricingPage() {
  return (
    <div className="bg-[#f7f4ec] text-slate-800">
      <MarketingNav />

      <section className="relative overflow-hidden">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-[-16rem] h-[34rem] bg-[radial-gradient(52rem_32rem_at_50%_0%,rgba(32,93,74,0.10),transparent_70%)]"
        />
        <div className="relative mx-auto max-w-3xl px-6 pb-8 pt-16 text-center sm:pt-24">
          <span className="text-xs font-medium uppercase tracking-[0.14em] text-[#205d4a]">Pricing</span>
          <h1 className="font-display mt-3 text-4xl font-medium tracking-tight text-slate-900 sm:text-5xl">
            Simple, honest pricing.
          </h1>
          <p className="mx-auto mt-5 max-w-xl text-lg leading-relaxed text-slate-500">
            Start free and track your whole portfolio, no holding cap, no credit card. Pro adds deeper
            analytics for people who want it, later. No ads, no upsell, no cold calls.
          </p>
        </div>
      </section>

      {/* Tiers */}
      <section className="mx-auto max-w-4xl px-6 pb-8">
        <div className="grid gap-6 md:grid-cols-2">
          {/* Free */}
          <div className="relative rounded-3xl border border-[#205d4a]/25 bg-white p-8 shadow-[0_1px_0_rgba(0,0,0,0.02),0_24px_48px_-24px_rgba(23,63,51,0.28)]">
            <span className="inline-flex rounded-full bg-[#edf3ee] px-2.5 py-0.5 text-[11px] font-medium uppercase tracking-[0.1em] text-[#205d4a]">
              Free forever
            </span>
            <div className="mt-4 flex items-baseline gap-1.5">
              <span className="font-display text-5xl font-medium tracking-tight text-slate-900">$0</span>
              <span className="text-sm text-slate-400">/ month</span>
            </div>
            <p className="mt-2 text-sm text-slate-500">Everything you need to see your real income.</p>
            <Link
              href="/login"
              className="mt-6 inline-flex w-full items-center justify-center rounded-xl bg-slate-900 py-3 text-sm font-medium text-[#f7f4ec] shadow-sm transition hover:bg-slate-800"
            >
              Get started free
            </Link>
            <ul className="mt-7 space-y-2.5 text-sm">
              {freeIncludes.map((f) => (
                <Check key={f}>{f}</Check>
              ))}
            </ul>
          </div>

          {/* Pro */}
          <div className="relative rounded-3xl border border-slate-200 bg-white p-8 shadow-soft">
            <span className="inline-flex rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-medium uppercase tracking-[0.1em] text-slate-500">
              Coming later
            </span>
            <div className="mt-4 flex items-baseline gap-1.5">
              <span className="font-display text-5xl font-medium tracking-tight text-slate-400">Pro</span>
            </div>
            <p className="mt-2 text-sm text-slate-500">For power users who want the deep end, on tap.</p>
            <button
              disabled
              className="mt-6 inline-flex w-full cursor-not-allowed items-center justify-center rounded-xl border border-slate-200 py-3 text-sm font-medium text-slate-400"
            >
              Coming soon
            </button>
            <ul className="mt-7 space-y-2.5 text-sm">
              {proIncludes.map((f) => (
                <Check key={f} muted>{f}</Check>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* Honesty band */}
      <section className="mx-auto max-w-4xl px-6 py-12">
        <div className="rounded-3xl border border-slate-200 bg-white/70 p-8">
          <h2 className="font-display text-2xl font-medium tracking-tight text-slate-900">What you&apos;ll never see</h2>
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <Never>Ads, anywhere</Never>
            <Never>Your data sold or shared</Never>
            <Never>Upsell nags or cold calls</Never>
            <Never>A lock-in that keeps your data hostage</Never>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="mx-auto max-w-3xl px-6 pb-16">
        <h2 className="font-display text-center text-3xl font-medium tracking-tight text-slate-900">Pricing questions</h2>
        <div className="mt-8 divide-y divide-slate-200 rounded-2xl border border-slate-200 bg-white px-6 shadow-soft">
          <Faq q="Is the free tier really free?" a="Yes, and it isn't a trial. Track your whole portfolio, dividends, and option income with no holding cap and no credit card." />
          <Faq q="When does Pro launch, and what will it cost?" a="Pro is on the roadmap, not live yet, so nothing charges today. When it arrives it'll be a fair, transparent monthly price, and the core free tier stays generous." />
          <Faq q="Will you ever charge for what's free today?" a="No. What's in the free tier stays in the free tier. Pro adds new depth on top; it doesn't take features away." />
          <Faq q="Can I export my data if I leave?" a="Any time. Export your transactions and holdings to CSV, or delete your account and everything in it. It's your data." />
        </div>
      </section>

      {/* CTA */}
      <section className="mx-auto max-w-6xl px-6 pb-20">
        <div className="overflow-hidden rounded-3xl border border-[#205d4a]/20 bg-gradient-to-br from-[#173f33] to-[#10322a] px-8 py-14 text-center shadow-[0_30px_60px_-30px_rgba(23,63,51,0.5)]">
          <h2 className="font-display text-3xl font-medium tracking-tight text-[#f7f4ec] sm:text-4xl">Start free today.</h2>
          <p className="mx-auto mt-4 max-w-lg text-lg leading-relaxed text-[#c7ddd3]">No card, no catch. See your income picture in minutes.</p>
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

function Check({ children, muted }: { children: React.ReactNode; muted?: boolean }) {
  return (
    <li className="flex items-start gap-2.5">
      <span aria-hidden className={muted ? "mt-0.5 text-slate-300" : "mt-0.5 text-[#205d4a]"}>✓</span>
      <span className={muted ? "text-slate-500" : "text-slate-700"}>{children}</span>
    </li>
  );
}

function Never({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2.5 text-sm">
      <span aria-hidden className="mt-0.5 text-rose-500">✕</span>
      <span className="text-slate-600">{children}</span>
    </div>
  );
}

function Faq({ q, a }: { q: string; a: string }) {
  return (
    <details className="group py-4">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-sm font-medium text-slate-900">
        {q}
        <span aria-hidden className="text-slate-400 transition group-open:rotate-45">+</span>
      </summary>
      <p className="mt-2 text-sm leading-relaxed text-slate-500">{a}</p>
    </details>
  );
}
