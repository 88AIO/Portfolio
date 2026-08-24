import Link from "next/link";
import BrandMark from "@/components/BrandMark";
import { APP_NAME } from "@/lib/legal";

export default function Home() {
  return (
    <main className="relative min-h-screen overflow-hidden bg-[#f7f4ec] text-slate-800">
      {/* soft paper wash — a single warm halo, not a rainbow gradient */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-[-18rem] h-[38rem] bg-[radial-gradient(60rem_38rem_at_50%_0%,rgba(32,93,74,0.10),transparent_70%)]"
      />

      <nav className="relative mx-auto flex max-w-6xl items-center justify-between px-6 py-6">
        <div className="flex items-center gap-2.5">
          <BrandMark className="h-8 w-8" />
          <span className="text-lg font-semibold tracking-tight text-slate-900">Snowfolio</span>
        </div>
        <div className="flex items-center gap-1">
          <Link href="/login" className="rounded-full px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-900">
            Sign in
          </Link>
          <Link
            href="/login"
            className="rounded-full bg-slate-900 px-4 py-2 text-sm font-medium text-[#f7f4ec] shadow-sm transition hover:bg-slate-800"
          >
            Get started
          </Link>
        </div>
      </nav>

      <section className="relative mx-auto max-w-3xl px-6 pb-16 pt-16 text-center sm:pt-24">
        <span className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white/70 px-3.5 py-1.5 text-xs font-medium uppercase tracking-[0.14em] text-slate-500 backdrop-blur">
          Portfolio · Dividends · Option income
        </span>
        <h1 className="font-display mt-7 text-5xl font-medium leading-[1.04] tracking-tight text-slate-900 sm:text-[3.85rem]">
          Your whole portfolio,
          <br className="hidden sm:block" /> in one{" "}
          <span className="italic text-[#205d4a]">honest</span> view.
        </h1>
        <p className="mx-auto mt-6 max-w-xl text-lg leading-relaxed text-slate-500">
          US and international holdings together, with the dividend and option income you&rsquo;re
          actually earning. Calm by default, honest about its data.
        </p>
        <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Link
            href="/login"
            className="inline-flex items-center gap-2 rounded-full bg-slate-900 px-6 py-3 font-medium text-[#f7f4ec] shadow-sm transition hover:bg-slate-800"
          >
            Get started free
            <span aria-hidden className="text-[#8fbfad]">→</span>
          </Link>
          <span className="text-sm text-slate-400">No credit card required.</span>
        </div>

        {/* A quiet product vignette — the income line, rendered in the brand palette. */}
        <div className="mx-auto mt-16 max-w-xl">
          <div className="rounded-3xl border border-slate-200 bg-white p-2 shadow-[0_1px_0_rgba(0,0,0,0.02),0_24px_48px_-24px_rgba(23,63,51,0.28)]">
            <div className="rounded-[1.35rem] bg-gradient-to-b from-white to-[#faf8f2] p-6 text-left">
              <div className="flex items-baseline justify-between">
                <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-slate-400">
                  Income this year
                </span>
                <span className="rounded-full bg-[#edf3ee] px-2 py-0.5 text-[11px] font-medium text-[#205d4a]">
                  Dividends + premium
                </span>
              </div>
              <div className="font-display mt-2 text-4xl font-medium tracking-tight text-slate-900 tabular-nums">
                $9,919
              </div>
              <div className="mt-5 flex items-end gap-1.5" aria-hidden>
                {[38, 52, 44, 61, 57, 72, 66, 83, 70, 88, 79, 96].map((h, i) => (
                  <div
                    key={i}
                    className="flex-1 rounded-sm bg-[#205d4a]"
                    style={{ height: `${h}px`, opacity: 0.35 + (i / 11) * 0.6 }}
                  />
                ))}
              </div>
              <div className="mt-3 flex justify-between text-[11px] text-slate-400">
                <span>Jan</span>
                <span>Dec</span>
              </div>
            </div>
          </div>
        </div>

        <div className="mx-auto mt-14 grid max-w-2xl gap-x-8 gap-y-6 sm:grid-cols-3">
          {[
            ["Two incomes, one view", "Dividends and option premium counted once, together."],
            ["Honest about its data", "Prices timestamped. No confident wrong numbers."],
            ["Yours, no lock-in", "Export any time. No ads, no upsell, generous free tier."],
          ].map(([title, body]) => (
            <div key={title} className="text-left">
              <div className="h-px w-8 bg-[#205d4a]/40" />
              <h3 className="mt-3 text-sm font-semibold text-slate-800">{title}</h3>
              <p className="mt-1 text-sm leading-relaxed text-slate-500">{body}</p>
            </div>
          ))}
        </div>

        <p className="mx-auto mt-14 max-w-lg text-xs leading-relaxed text-slate-400">
          Snowfolio is an informational tool, not a financial adviser. Nothing here is investment
          advice. See our{" "}
          <Link href="/legal/disclaimer" className="underline decoration-slate-300 hover:text-slate-600">
            Disclaimer
          </Link>
          .
        </p>
      </section>

      <footer className="relative mx-auto max-w-6xl px-6 py-10">
        <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 border-t border-slate-200 pt-6 text-sm text-slate-500">
          <span className="text-slate-400">© {APP_NAME}</span>
          <Link href="/legal/disclaimer" className="hover:text-[#205d4a]">Disclaimer</Link>
          <Link href="/legal/terms" className="hover:text-[#205d4a]">Terms</Link>
          <Link href="/legal/privacy" className="hover:text-[#205d4a]">Privacy</Link>
        </div>
      </footer>
    </main>
  );
}
