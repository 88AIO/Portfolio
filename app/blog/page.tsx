import Link from "next/link";
import type { Metadata } from "next";
import MarketingNav from "@/components/marketing/MarketingNav";
import MarketingFooter from "@/components/marketing/MarketingFooter";
import { posts, formatDate } from "@/lib/content/blog";

export const metadata: Metadata = {
  title: "Blog — Snowfolio",
  description:
    "Notes on income investing, honest data, and building a calm portfolio tracker. From the team behind Snowfolio.",
};

export default function BlogIndex() {
  const [lead, ...rest] = posts;
  return (
    <div className="bg-[#f7f4ec] text-slate-800">
      <MarketingNav />

      <section className="relative overflow-hidden">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-[-16rem] h-[34rem] bg-[radial-gradient(52rem_32rem_at_50%_0%,rgba(32,93,74,0.10),transparent_70%)]"
        />
        <div className="relative mx-auto max-w-3xl px-6 pb-6 pt-16 text-center sm:pt-24">
          <span className="text-xs font-medium uppercase tracking-[0.14em] text-[#205d4a]">Blog</span>
          <h1 className="font-display mt-3 text-4xl font-medium tracking-tight text-slate-900 sm:text-5xl">
            Notes on income, honestly.
          </h1>
          <p className="mx-auto mt-5 max-w-xl text-lg leading-relaxed text-slate-500">
            Thinking out loud about dividends, option income, honest data, and building a tracker
            worth trusting.
          </p>
        </div>
      </section>

      <section className="mx-auto max-w-5xl px-6 pb-20">
        {/* Lead post */}
        <Link
          href={`/blog/${lead.slug}`}
          className="group block overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-soft transition hover:shadow-[0_1px_0_rgba(0,0,0,0.02),0_28px_52px_-28px_rgba(23,63,51,0.30)]"
        >
          <div className="grid md:grid-cols-2">
            <div className="flex items-center justify-center bg-gradient-to-br from-[#173f33] to-[#10322a] p-10">
              <span className="font-display text-center text-2xl font-medium leading-snug text-[#f7f4ec]">{lead.title}</span>
            </div>
            <div className="p-8">
              <Meta tag={lead.tag} date={lead.date} readMins={lead.readMins} />
              <h2 className="font-display mt-3 text-2xl font-medium tracking-tight text-slate-900 group-hover:text-[#205d4a]">
                {lead.title}
              </h2>
              <p className="mt-3 text-sm leading-relaxed text-slate-500">{lead.excerpt}</p>
              <span className="mt-4 inline-block text-sm font-medium text-[#205d4a]">Read the post →</span>
            </div>
          </div>
        </Link>

        {/* Rest */}
        <div className="mt-8 grid gap-6 md:grid-cols-2">
          {rest.map((p) => (
            <Link
              key={p.slug}
              href={`/blog/${p.slug}`}
              className="group flex flex-col rounded-2xl border border-slate-200 bg-white p-6 shadow-soft transition hover:shadow-[0_1px_0_rgba(0,0,0,0.02),0_24px_44px_-26px_rgba(23,63,51,0.28)]"
            >
              <Meta tag={p.tag} date={p.date} readMins={p.readMins} />
              <h2 className="font-display mt-3 text-xl font-medium tracking-tight text-slate-900 group-hover:text-[#205d4a]">{p.title}</h2>
              <p className="mt-2 flex-1 text-sm leading-relaxed text-slate-500">{p.excerpt}</p>
              <span className="mt-4 text-sm font-medium text-[#205d4a]">Read the post →</span>
            </Link>
          ))}
        </div>
      </section>

      <MarketingFooter />
    </div>
  );
}

function Meta({ tag, date, readMins }: { tag: string; date: string; readMins: number }) {
  return (
    <div className="flex items-center gap-2 text-xs text-slate-400">
      <span className="rounded-full bg-[#edf3ee] px-2 py-0.5 font-medium text-[#205d4a]">{tag}</span>
      <span>·</span>
      <span>{formatDate(date)}</span>
      <span>·</span>
      <span>{readMins} min read</span>
    </div>
  );
}
