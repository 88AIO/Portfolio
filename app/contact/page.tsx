import Link from "next/link";
import type { Metadata } from "next";
import MarketingNav from "@/components/marketing/MarketingNav";
import MarketingFooter from "@/components/marketing/MarketingFooter";
import { CONTACT_EMAIL } from "@/lib/legal";

export const metadata: Metadata = {
  title: "Contact — Snowfolio",
  description:
    "Get in touch with Snowfolio. Email us for support, privacy and legal requests, or product feedback. Built by a solo maker who reads every message.",
};

export default function ContactPage() {
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
          <span className="text-xs font-medium uppercase tracking-[0.14em] text-[#205d4a]">Contact</span>
          <h1 className="font-display mt-3 text-4xl font-medium tracking-tight text-slate-900 sm:text-5xl">
            We&apos;d love to hear from you.
          </h1>
          <p className="mx-auto mt-5 max-w-xl text-lg leading-relaxed text-slate-500">
            Snowfolio is built and run by a solo maker who reads every message. The fastest way to
            reach us is email, and we aim to reply within two business days.
          </p>
          <a
            href={`mailto:${CONTACT_EMAIL}`}
            className="mt-8 inline-flex items-center gap-2 rounded-full bg-slate-900 px-6 py-3 font-medium text-[#f7f4ec] shadow-sm transition hover:bg-slate-800"
          >
            Email {CONTACT_EMAIL}
            <span aria-hidden className="text-[#8fbfad]">→</span>
          </a>
        </div>
      </section>

      {/* Channels */}
      <section className="mx-auto max-w-4xl px-6 py-12">
        <div className="grid gap-6 md:grid-cols-3">
          <Channel
            title="Support"
            body="Stuck on an import, a price that looks off, or anything in the app? Send the details and we'll dig in."
            subject="Support request"
          />
          <Channel
            title="Privacy & legal"
            body="Data requests (access, correction, deletion) and legal notices. We honor them, and you can delete your account any time."
            subject="Privacy request"
          />
          <Channel
            title="Feedback & ideas"
            body="Tell us what's missing or what would make Snowfolio better. This is what shapes the roadmap."
            subject="Product feedback"
          />
        </div>
      </section>

      {/* Note */}
      <section className="mx-auto max-w-3xl px-6 pb-16">
        <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm leading-relaxed text-slate-500 shadow-soft">
          Prefer to handle it yourself first? You can{" "}
          <Link href="/dashboard/settings" className="font-medium text-[#205d4a] hover:underline">
            export or delete your data
          </Link>{" "}
          from Settings any time, and the{" "}
          <Link href="/#features" className="font-medium text-[#205d4a] hover:underline">
            feature overview
          </Link>{" "}
          and{" "}
          <Link href="/pricing" className="font-medium text-[#205d4a] hover:underline">
            pricing FAQ
          </Link>{" "}
          answer the most common questions.
        </div>
      </section>

      {/* CTA */}
      <section className="mx-auto max-w-6xl px-6 pb-20">
        <div className="overflow-hidden rounded-3xl border border-[#205d4a]/20 bg-gradient-to-br from-[#173f33] to-[#10322a] px-8 py-14 text-center shadow-[0_30px_60px_-30px_rgba(23,63,51,0.5)]">
          <h2 className="font-display text-3xl font-medium tracking-tight text-[#f7f4ec] sm:text-4xl">Ready when you are.</h2>
          <p className="mx-auto mt-4 max-w-lg text-lg leading-relaxed text-[#c7ddd3]">Start free, and reach out any time.</p>
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

function Channel({ title, body, subject }: { title: string; body: string; subject: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-soft">
      <h2 className="text-base font-semibold text-slate-900">{title}</h2>
      <p className="mt-1.5 text-sm leading-relaxed text-slate-500">{body}</p>
      <a
        href={`mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(subject)}`}
        className="mt-4 inline-block text-sm font-medium text-[#205d4a] hover:underline"
      >
        Email us →
      </a>
    </div>
  );
}
