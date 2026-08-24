import Link from "next/link";
import type { Metadata } from "next";
import MarketingNav from "@/components/marketing/MarketingNav";
import MarketingFooter from "@/components/marketing/MarketingFooter";
import { releases } from "@/lib/content/changelog";
import { formatDate } from "@/lib/content/blog";

export const metadata: Metadata = {
  title: "Changelog — Snowfolio",
  description: "What's new in Snowfolio. Product updates, improvements, and fixes, in plain language.",
};

const tagStyle: Record<string, string> = {
  New: "bg-[#edf3ee] text-[#205d4a]",
  Improved: "bg-[#f6ecd8] text-[#8a6a1f]",
  Fixed: "bg-slate-100 text-slate-600",
};

export default function ChangelogPage() {
  return (
    <div className="bg-[#f7f4ec] text-slate-800">
      <MarketingNav />

      <section className="relative overflow-hidden">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-[-16rem] h-[34rem] bg-[radial-gradient(52rem_32rem_at_50%_0%,rgba(32,93,74,0.10),transparent_70%)]"
        />
        <div className="relative mx-auto max-w-3xl px-6 pb-6 pt-16 text-center sm:pt-24">
          <span className="text-xs font-medium uppercase tracking-[0.14em] text-[#205d4a]">Changelog</span>
          <h1 className="font-display mt-3 text-4xl font-medium tracking-tight text-slate-900 sm:text-5xl">What&apos;s new.</h1>
          <p className="mx-auto mt-5 max-w-xl text-lg leading-relaxed text-slate-500">
            Every meaningful change to Snowfolio, in plain language. We ship in the open.
          </p>
        </div>
      </section>

      <section className="mx-auto max-w-3xl px-6 pb-20">
        <ol className="relative border-l border-slate-200 pl-8">
          {releases.map((r, i) => (
            <li key={i} className="mb-12 last:mb-0">
              <span className="absolute -left-[7px] mt-1.5 h-3.5 w-3.5 rounded-full border-2 border-[#f7f4ec] bg-[#205d4a]" />
              <div className="flex flex-wrap items-center gap-3">
                <time className="text-sm font-medium text-slate-400">{formatDate(r.date)}</time>
                <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-[0.08em] ${tagStyle[r.tag]}`}>{r.tag}</span>
              </div>
              <h2 className="font-display mt-2 text-xl font-medium tracking-tight text-slate-900">{r.title}</h2>
              <ul className="mt-3 space-y-2">
                {r.points.map((p, j) => (
                  <li key={j} className="flex items-start gap-2.5 text-sm leading-relaxed text-slate-600">
                    <span aria-hidden className="mt-0.5 text-[#205d4a]">·</span>
                    <span>{p}</span>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ol>

        <div className="mt-14 rounded-2xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-500 shadow-soft">
          Have an idea for what to build next?{" "}
          <Link href="/contact" className="font-medium text-[#205d4a] hover:underline">Tell us →</Link>
        </div>
      </section>

      <MarketingFooter />
    </div>
  );
}
