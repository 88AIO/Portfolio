import Link from "next/link";
import BrandMark from "@/components/BrandMark";

// Branded 404: shown for unknown URLs and every notFound() call (e.g. an unknown blog slug or a
// holding the signed-in user doesn't own). A calm, on-brand dead-end with a clear way back —
// never Next's bare default page.
export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f7f4ec] px-4 text-slate-800">
      <div className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-8 text-center shadow-[0_1px_0_rgba(0,0,0,0.02),0_24px_48px_-28px_rgba(23,63,51,0.30)]">
        <BrandMark className="mx-auto mb-4 block h-10 w-10" />
        <p className="font-display text-4xl font-medium tracking-tight text-slate-900">404</p>
        <h1 className="mt-1 font-display text-xl font-medium tracking-tight">This page isn&apos;t here</h1>
        <p className="mt-2 text-sm text-slate-500">
          The link may be broken or the page may have moved. Nothing&apos;s wrong with your account.
        </p>
        <div className="mt-6 flex justify-center gap-3">
          <Link
            href="/"
            className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-[#f7f4ec] hover:bg-slate-800"
          >
            Go home
          </Link>
          <Link
            href="/dashboard"
            className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Open dashboard
          </Link>
        </div>
      </div>
    </main>
  );
}
