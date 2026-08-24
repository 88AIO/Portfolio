import Link from "next/link";
import { APP_NAME } from "@/lib/legal";

export default function Home() {
  return (
    <main className="min-h-screen bg-gradient-to-b from-slate-50 to-white text-slate-800">
      <nav className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
        <div className="flex items-center gap-2">
          <div className="h-8 w-8 rounded-full bg-gradient-to-br from-sky-400 to-indigo-500" />
          <span className="text-xl font-semibold">Snowfolio</span>
        </div>
        <Link href="/login" className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700">
          Sign in
        </Link>
      </nav>

      <section className="mx-auto max-w-3xl px-6 py-24 text-center">
        <h1 className="text-4xl font-bold tracking-tight text-slate-900 sm:text-5xl">
          Your whole portfolio, in one honest view.
        </h1>
        <p className="mx-auto mt-5 max-w-xl text-lg text-slate-500">
          US and international holdings together, with the dividend and option income you&rsquo;re
          actually earning. Calm by default, honest about its data.
        </p>
        <Link href="/login" className="mt-8 inline-block rounded-xl bg-indigo-600 px-6 py-3 font-medium text-white hover:bg-indigo-700">
          Get started free
        </Link>
        <p className="mt-3 text-sm text-slate-400">No credit card required.</p>
        <p className="mx-auto mt-6 max-w-lg text-xs text-slate-400">
          Snowfolio is an informational tool, not a financial adviser — nothing here is investment
          advice. See our{" "}
          <Link href="/legal/disclaimer" className="underline hover:text-slate-600">Disclaimer</Link>.
        </p>
      </section>

      <footer className="mx-auto max-w-6xl px-6 py-10">
        <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 border-t border-slate-200 pt-6 text-sm text-slate-500">
          <span className="text-slate-400">© {APP_NAME}</span>
          <Link href="/legal/disclaimer" className="hover:text-indigo-600">Disclaimer</Link>
          <Link href="/legal/terms" className="hover:text-indigo-600">Terms</Link>
          <Link href="/legal/privacy" className="hover:text-indigo-600">Privacy</Link>
        </div>
      </footer>
    </main>
  );
}
