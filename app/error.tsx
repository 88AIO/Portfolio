"use client";

import BrandMark from "@/components/BrandMark";

// Global error boundary: a calm recovery screen instead of Next's default crash page.
// Covers render/data failures across the app (e.g. a transient Supabase outage).
export default function Error({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4 text-slate-800">
      <div className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-8 text-center shadow-[0_1px_0_rgba(0,0,0,0.02),0_24px_48px_-28px_rgba(23,63,51,0.30)]">
        <BrandMark className="mx-auto mb-4 block h-10 w-10" />
        <h1 className="font-display text-xl font-medium tracking-tight">Something went wrong</h1>
        <p className="mt-2 text-sm text-slate-500">
          We hit a snag loading this page. Your data is safe, and this is usually temporary.
        </p>
        <div className="mt-6 flex justify-center gap-3">
          <button
            onClick={reset}
            className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-[#f7f4ec] hover:bg-slate-800"
          >
            Try again
          </button>
          <a
            href="/dashboard"
            className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Back to dashboard
          </a>
        </div>
      </div>
    </main>
  );
}
