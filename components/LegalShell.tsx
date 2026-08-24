import Link from "next/link";
import { APP_NAME, LAST_UPDATED } from "@/lib/legal";

// Consistent frame for the legal pages: brand header, a clear not-advice banner, a readable prose
// column, and cross-links between the three documents.
export default function LegalShell({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <main className="min-h-screen bg-slate-50 text-slate-800">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-4">
          <Link href="/" className="flex items-center gap-2">
            <span className="h-7 w-7 rounded-full bg-gradient-to-br from-sky-400 to-indigo-500" />
            <span className="text-lg font-semibold">{APP_NAME}</span>
          </Link>
          <Link href="/login" className="text-sm text-indigo-600 hover:underline">Sign in</Link>
        </div>
      </header>

      <div className="mx-auto max-w-3xl px-6 py-10">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">{title}</h1>
        <p className="mt-1 text-sm text-slate-400">Last updated: {LAST_UPDATED}</p>

        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          <strong>{APP_NAME} is an informational tool, not a financial adviser.</strong> Nothing here is
          investment, tax, legal, or financial advice. See our{" "}
          <Link href="/legal/disclaimer" className="underline">Disclaimer</Link>.
        </div>

        <article className="legal-prose mt-8 space-y-5 text-[15px] leading-relaxed text-slate-700">
          {children}
        </article>

        <nav className="mt-12 flex flex-wrap gap-4 border-t border-slate-200 pt-6 text-sm text-slate-500">
          <Link href="/legal/disclaimer" className="hover:text-indigo-600">Disclaimer</Link>
          <Link href="/legal/terms" className="hover:text-indigo-600">Terms of Service</Link>
          <Link href="/legal/privacy" className="hover:text-indigo-600">Privacy Policy</Link>
          <Link href="/" className="ml-auto hover:text-indigo-600">← Home</Link>
        </nav>
      </div>
    </main>
  );
}

// Small helpers so each page reads like a document.
export function H2({ children }: { children: React.ReactNode }) {
  return <h2 className="pt-3 text-lg font-semibold text-slate-900">{children}</h2>;
}
export function P({ children }: { children: React.ReactNode }) {
  return <p>{children}</p>;
}
export function UL({ children }: { children: React.ReactNode }) {
  return <ul className="list-disc space-y-1.5 pl-6">{children}</ul>;
}
