import Link from "next/link";
import type { Metadata } from "next";
import MarketingNav from "@/components/marketing/MarketingNav";
import MarketingFooter from "@/components/marketing/MarketingFooter";

export const metadata: Metadata = {
  title: "Snowfolio — Your whole portfolio, in one honest view",
  description:
    "A calm tracker for portfolio performance and income: dividends plus option premium, built for options sellers and dividend investors. Honest, timestamped data. US and international.",
};

export default function Home() {
  return (
    <div className="bg-[#f7f4ec] text-slate-800">
      <MarketingNav />

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-[-18rem] h-[40rem] bg-[radial-gradient(60rem_38rem_at_50%_0%,rgba(32,93,74,0.10),transparent_70%)]"
        />
        <div className="relative mx-auto max-w-3xl px-6 pb-16 pt-16 text-center sm:pt-24">
          <span className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white/70 px-3.5 py-1.5 text-xs font-medium uppercase tracking-[0.14em] text-slate-500 backdrop-blur">
            Portfolio · Dividends · Option income
          </span>
          <h1 className="font-display mt-7 text-5xl font-medium leading-[1.04] tracking-tight text-slate-900 sm:text-[3.85rem]">
            Your whole portfolio,
            <br className="hidden sm:block" /> in one{" "}
            <span className="italic text-[#205d4a]">honest</span> view.
          </h1>
          <p className="mx-auto mt-6 max-w-xl text-lg leading-relaxed text-slate-500">
            The only calm tracker that shows dividends and option premium as one income picture, built
            for the way you actually invest. US and international, honest about its data.
          </p>
          <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link
              href="/login"
              className="inline-flex items-center gap-2 rounded-full bg-slate-900 px-6 py-3 font-medium text-[#f7f4ec] shadow-sm transition hover:bg-slate-800"
            >
              Get started free
              <span aria-hidden className="text-[#8fbfad]">→</span>
            </Link>
            <Link href="/pricing" className="text-sm font-medium text-slate-500 hover:text-slate-800">
              See what&apos;s free →
            </Link>
          </div>
          <p className="mt-3 text-sm text-slate-400">No credit card. No ads. Export any time.</p>

          {/* Income vignette */}
          <div className="mx-auto mt-16 max-w-xl">
            <div className="rounded-3xl border border-slate-200 bg-white p-2 shadow-[0_1px_0_rgba(0,0,0,0.02),0_24px_48px_-24px_rgba(23,63,51,0.28)]">
              <div className="rounded-[1.35rem] bg-gradient-to-b from-white to-[#faf8f2] p-6 text-left">
                <div className="flex items-baseline justify-between">
                  <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-slate-400">Income this year</span>
                  <span className="rounded-full bg-[#edf3ee] px-2 py-0.5 text-[11px] font-medium text-[#205d4a]">Dividends + premium</span>
                </div>
                <div className="font-display mt-2 text-4xl font-medium tracking-tight text-slate-900 tabular-nums">$9,919</div>
                <div className="mt-5 flex items-end gap-1.5" aria-hidden>
                  {[38, 52, 44, 61, 57, 72, 66, 83, 70, 88, 79, 96].map((h, i) => (
                    <div key={i} className="flex-1 rounded-sm bg-[#205d4a]" style={{ height: `${h}px`, opacity: 0.35 + (i / 11) * 0.6 }} />
                  ))}
                </div>
                <div className="mt-3 flex justify-between text-[11px] text-slate-400">
                  <span>Jan</span>
                  <span>Dec</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Quiet trust strip */}
      <section className="border-y border-slate-200/70 bg-[#f4f0e6]">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-center gap-x-8 gap-y-2 px-6 py-5 text-sm text-slate-500">
          <span>For dividend investors &amp; options sellers</span>
          <span className="text-slate-300">·</span>
          <span>US and international</span>
          <span className="text-slate-300">·</span>
          <span>Prices you can trust, timestamped</span>
          <span className="text-slate-300">·</span>
          <span>No ads, ever</span>
        </div>
      </section>

      {/* The problem */}
      <section className="mx-auto max-w-3xl px-6 py-20 text-center">
        <h2 className="font-display text-3xl font-medium tracking-tight text-slate-900 sm:text-4xl">
          Most trackers miss half your income.
        </h2>
        <p className="mx-auto mt-5 max-w-xl text-lg leading-relaxed text-slate-500">
          If you sell covered calls or cash-secured puts, that premium is real income, yet it lives in
          a different app from your dividends, or nowhere at all. Snowfolio puts both in one place,
          counts each dollar once, and never pretends a stale price is fresh.
        </p>
      </section>

      {/* Features */}
      <section id="features" className="scroll-mt-20 bg-white/60 py-20">
        <div className="mx-auto max-w-6xl px-6">
          <div className="mx-auto max-w-2xl text-center">
            <span className="text-xs font-medium uppercase tracking-[0.14em] text-[#205d4a]">What you get</span>
            <h2 className="font-display mt-3 text-3xl font-medium tracking-tight text-slate-900 sm:text-4xl">
              Everything your income needs, nothing that gets in the way.
            </h2>
          </div>
          <div className="mt-14 grid gap-x-8 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
            <Feature title="Two incomes, one view" body="Dividends and net option premium, added up together and counted exactly once. Finally see what your portfolio really pays you." />
            <Feature title="An options-seller cockpit" body="Track the wheel end to end: premium collected over time, cash set aside, annualized return, and covered vs. uncovered, per contract." />
            <Feature title="Dividend calendar & safety" body="A forward 12-month payout calendar, plus a calm 0–100 safety read from each holding's own history. Thin history stays unrated, not guessed." />
            <Feature title="Honest, timestamped prices" body="Every price shows when it was last updated. We would rather show a number we can stand behind than a confident wrong one." />
            <Feature title="Performance vs. the S&P 500" body="See your value over time reconstructed from your trades, benchmarked dollar-for-dollar against the same money in SPY." />
            <Feature title="US and international" body="Hold Apple and 0700.HK side by side. Everything rolls up into your base currency with server-side FX, no spreadsheets." />
            <Feature title="Realized gains & a tax view" body="FIFO-matched realized sales, short vs. long term, dividends, and option premium for the year, ready for filing season." />
            <Feature title="Your data, no lock-in" body="Import a CSV or broker export (de-duplicated), and export everything any time. It's your data, and it round-trips cleanly." />
            <Feature title="Calm by default" body="The home screen answers what you own, what it's worth, and what income is coming. The deep analytics are one tap away, off by default." />
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="mx-auto max-w-5xl px-6 py-20">
        <div className="mx-auto max-w-2xl text-center">
          <span className="text-xs font-medium uppercase tracking-[0.14em] text-[#205d4a]">How it works</span>
          <h2 className="font-display mt-3 text-3xl font-medium tracking-tight text-slate-900 sm:text-4xl">Up and running in minutes.</h2>
        </div>
        <div className="mt-14 grid gap-8 md:grid-cols-3">
          <Step n={1} title="Add what you own" body="Type a ticker and shares, import a spreadsheet or broker export, or connect a brokerage. Whatever's easiest." />
          <Step n={2} title="We fill in the rest" body="Live prices, dividend history, sectors, and FX arrive automatically, and refresh every night." />
          <Step n={3} title="See your real income" body="Watch your value, dividends, and option premium come together in one calm, honest picture." />
        </div>
      </section>

      {/* Who it's for */}
      <section className="bg-white/60 py-20">
        <div className="mx-auto max-w-6xl px-6">
          <div className="mx-auto max-w-2xl text-center">
            <span className="text-xs font-medium uppercase tracking-[0.14em] text-[#205d4a]">Who it&apos;s for</span>
            <h2 className="font-display mt-3 text-3xl font-medium tracking-tight text-slate-900 sm:text-4xl">Built for income investors.</h2>
          </div>
          <div className="mt-14 grid gap-6 md:grid-cols-3">
            <Persona title="Options sellers" body="Running the wheel? See premium income over time, what's expiring, and what might get assigned, without a trading terminal shouting at you." />
            <Persona title="Dividend investors" body="A forward calendar, per-holding yield, and a safety read, so you can plan the income you're actually building." />
            <Persona title="Global, multi-account" body="US and international holdings across several brokers, rolled up to one honest total with no duplicate lines." />
          </div>
        </div>
      </section>

      {/* Why Snowfolio */}
      <section className="mx-auto max-w-5xl px-6 py-20">
        <div className="mx-auto max-w-2xl text-center">
          <span className="text-xs font-medium uppercase tracking-[0.14em] text-[#205d4a]">Why Snowfolio</span>
          <h2 className="font-display mt-3 text-3xl font-medium tracking-tight text-slate-900 sm:text-4xl">The seat no one else was sitting in.</h2>
          <p className="mx-auto mt-5 max-w-xl text-lg leading-relaxed text-slate-500">
            The big trackers are powerful but overwhelming, or simple but dishonest about their data.
            Snowfolio takes a clearer line.
          </p>
        </div>
        <div className="mx-auto mt-12 grid max-w-3xl gap-4 sm:grid-cols-2">
          <Diff title="Dividends + premium, together" body="The income picture options sellers actually live in. No rival puts both in one place." />
          <Diff title="Fresh, honest prices" body="Timestamped data and return-of-capital transparency, instead of quietly stale numbers." />
          <Diff title="A genuinely generous free tier" body="No 10-holding cap. Track your whole portfolio without hitting a paywall." />
          <Diff title="Track & inform, never advise" body="We surface what's happening. We never tell you what to trade, and never sell your data." />
        </div>
      </section>

      {/* FAQ */}
      <section className="bg-white/60 py-20">
        <div className="mx-auto max-w-3xl px-6">
          <h2 className="font-display text-center text-3xl font-medium tracking-tight text-slate-900 sm:text-4xl">Questions, answered</h2>
          <div className="mt-10 divide-y divide-slate-200 rounded-2xl border border-slate-200 bg-white px-6 shadow-soft">
            <Faq q="Is it really free?" a="Yes. The free tier tracks your whole portfolio, dividends, and option income with no holding cap. A Pro tier with deeper analytics is coming later; the core stays generous." />
            <Faq q="Do you give financial advice?" a="No. Snowfolio is informational only. It tracks and informs, it never recommends trades, and nothing here is investment advice." />
            <Faq q="Where does the data come from?" a="Market data comes from established providers and is cached and timestamped, so you always see when a price was last updated. Dividend history powers the calendar and safety score." />
            <Faq q="Can I import from my broker?" a="Yes. Import a CSV or broker export (imports are de-duplicated, so re-importing is safe), or connect a brokerage where available. You can export everything any time." />
            <Faq q="Do you support international stocks?" a="Yes, and it's a first-class feature. Hold US and international names together; everything converts to your base currency server-side." />
            <Faq q="Is my data private?" a="Your data is yours. We don't run ads, don't sell your data, and you can export or delete your account and everything in it whenever you like." />
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="mx-auto max-w-6xl px-6 py-20">
        <div className="overflow-hidden rounded-3xl border border-[#205d4a]/20 bg-gradient-to-br from-[#173f33] to-[#10322a] px-8 py-16 text-center shadow-[0_30px_60px_-30px_rgba(23,63,51,0.5)]">
          <h2 className="font-display text-3xl font-medium tracking-tight text-[#f7f4ec] sm:text-4xl">
            See what your portfolio really pays you.
          </h2>
          <p className="mx-auto mt-4 max-w-lg text-lg leading-relaxed text-[#c7ddd3]">
            Free to start, honest by design. Your income picture is a few minutes away.
          </p>
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

function Feature({ title, body }: { title: string; body: string }) {
  return (
    <div>
      <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#edf3ee]">
        <span className="h-2.5 w-2.5 rounded-sm bg-[#205d4a]" />
      </div>
      <h3 className="mt-4 text-base font-semibold text-slate-900">{title}</h3>
      <p className="mt-1.5 text-sm leading-relaxed text-slate-500">{body}</p>
    </div>
  );
}

function Step({ n, title, body }: { n: number; title: string; body: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-soft">
      <div className="font-display flex h-9 w-9 items-center justify-center rounded-full bg-[#edf3ee] text-sm font-medium text-[#205d4a]">{n}</div>
      <h3 className="mt-4 text-base font-semibold text-slate-900">{title}</h3>
      <p className="mt-1.5 text-sm leading-relaxed text-slate-500">{body}</p>
    </div>
  );
}

function Persona({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-soft">
      <h3 className="font-display text-xl font-medium tracking-tight text-slate-900">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-slate-500">{body}</p>
    </div>
  );
}

function Diff({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-soft">
      <div className="flex items-start gap-2.5">
        <span aria-hidden className="mt-0.5 text-[#205d4a]">✓</span>
        <div>
          <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
          <p className="mt-1 text-sm leading-relaxed text-slate-500">{body}</p>
        </div>
      </div>
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
