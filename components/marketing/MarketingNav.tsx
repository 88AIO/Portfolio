"use client";

import { useState } from "react";
import Link from "next/link";
import BrandMark from "@/components/BrandMark";

const LINKS: [string, string][] = [
  ["Features", "/#features"],
  ["Pricing", "/pricing"],
  ["Blog", "/blog"],
  ["About", "/about"],
  ["Contact", "/contact"],
];

// Shared top nav for the public marketing pages. Sticky, with a paper backdrop blur.
// Desktop shows the full link set; on small screens the links collapse behind a menu button.
export default function MarketingNav() {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);

  return (
    <nav className="sticky top-0 z-40 border-b border-slate-200/70 bg-[#f7f4ec]/85 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <Link href="/" onClick={close} className="flex items-center gap-2.5">
          <BrandMark className="h-8 w-8" />
          <span className="text-lg font-semibold tracking-tight text-slate-900">Snowfolio</span>
        </Link>

        <div className="flex items-center gap-1">
          {LINKS.map(([label, href]) => (
            <Link
              key={label}
              href={href}
              className="hidden rounded-full px-3.5 py-2 text-sm font-medium text-slate-600 transition hover:text-slate-900 sm:inline-block"
            >
              {label}
            </Link>
          ))}
          <Link href="/login" className="hidden rounded-full px-3.5 py-2 text-sm font-medium text-slate-600 transition hover:text-slate-900 sm:inline-block">
            Sign in
          </Link>
          <Link
            href="/login"
            className="rounded-full bg-slate-900 px-4 py-2 text-sm font-medium text-[#f7f4ec] shadow-sm transition hover:bg-slate-800"
          >
            Get started
          </Link>

          {/* Mobile menu toggle */}
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
            aria-controls="mobile-menu"
            className="ml-1 inline-flex h-9 w-9 items-center justify-center rounded-full text-slate-700 transition hover:bg-slate-900/5 sm:hidden"
          >
            {open ? (
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                <path d="M4 7h16M4 12h16M4 17h16" />
              </svg>
            )}
          </button>
        </div>
      </div>

      {/* Mobile menu panel */}
      {open && (
        <div id="mobile-menu" className="border-t border-slate-200/70 bg-[#f7f4ec] sm:hidden">
          <div className="mx-auto flex max-w-6xl flex-col px-6 py-2">
            {LINKS.map(([label, href]) => (
              <Link
                key={label}
                href={href}
                onClick={close}
                className="rounded-lg px-2 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-slate-900/5"
              >
                {label}
              </Link>
            ))}
            <Link
              href="/login"
              onClick={close}
              className="mt-1 rounded-lg border-t border-slate-200/70 px-2 pb-2 pt-3 text-sm font-medium text-slate-700 transition hover:bg-slate-900/5"
            >
              Sign in
            </Link>
          </div>
        </div>
      )}
    </nav>
  );
}
