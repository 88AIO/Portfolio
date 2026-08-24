import Link from "next/link";
import BrandMark from "@/components/BrandMark";

// Shared top nav for the public marketing pages. Sticky, with a paper backdrop blur.
export default function MarketingNav() {
  return (
    <nav className="sticky top-0 z-40 border-b border-slate-200/70 bg-[#f7f4ec]/85 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <Link href="/" className="flex items-center gap-2.5">
          <BrandMark className="h-8 w-8" />
          <span className="text-lg font-semibold tracking-tight text-slate-900">Snowfolio</span>
        </Link>
        <div className="flex items-center gap-1">
          <Link href="/#features" className="hidden rounded-full px-3.5 py-2 text-sm font-medium text-slate-600 transition hover:text-slate-900 sm:inline-block">
            Features
          </Link>
          <Link href="/pricing" className="hidden rounded-full px-3.5 py-2 text-sm font-medium text-slate-600 transition hover:text-slate-900 sm:inline-block">
            Pricing
          </Link>
          <Link href="/about" className="hidden rounded-full px-3.5 py-2 text-sm font-medium text-slate-600 transition hover:text-slate-900 sm:inline-block">
            About
          </Link>
          <Link href="/login" className="rounded-full px-3.5 py-2 text-sm font-medium text-slate-600 transition hover:text-slate-900">
            Sign in
          </Link>
          <Link
            href="/login"
            className="rounded-full bg-slate-900 px-4 py-2 text-sm font-medium text-[#f7f4ec] shadow-sm transition hover:bg-slate-800"
          >
            Get started
          </Link>
        </div>
      </div>
    </nav>
  );
}
