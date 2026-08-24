"use client";

import { useState } from "react";
import Link from "next/link";
import BrandMark from "@/components/BrandMark";
import { signOut } from "@/app/dashboard/actions";

type NavKey = "overview" | "performance" | "dividends" | "options" | "tax" | "cash" | "broker" | "settings";

const NAV: [NavKey, string, string][] = [
  ["overview", "Overview", "/dashboard"],
  ["performance", "Performance", "/dashboard/performance"],
  ["dividends", "Dividends", "/dashboard/dividends"],
  ["options", "Options", "/dashboard/options"],
  ["tax", "Tax", "/dashboard/tax"],
  ["cash", "Cash", "/dashboard/cash"],
  ["broker", "Brokers", "/dashboard/broker"],
  ["settings", "Settings", "/dashboard/settings"],
];

// Shared dashboard header. The full link set shows on large screens; below that it collapses
// behind a menu button so the dark nav never overflows on a phone.
export default function DashboardNav({ active, email }: { active: NavKey; email?: string | null }) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);

  return (
    <header className="border-b border-slate-800 bg-slate-900 text-white">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3.5">
        <Link href="/dashboard" onClick={close} className="flex items-center gap-2.5">
          <BrandMark className="h-8 w-8" />
          <span className="text-lg font-semibold tracking-tight">Snowfolio</span>
        </Link>

        {/* Desktop nav */}
        <nav className="hidden items-center gap-1 text-sm lg:flex">
          {NAV.map(([key, label, href]) =>
            key === active ? (
              <span key={key} className="rounded-lg bg-white/10 px-3 py-1.5 font-medium">{label}</span>
            ) : (
              <Link key={key} href={href} className="rounded-lg px-3 py-1.5 text-slate-300 transition hover:bg-white/10">
                {label}
              </Link>
            ),
          )}
          {email && <span className="ml-2 hidden text-slate-400 xl:inline">{email}</span>}
          <form action={signOut}>
            <button className="ml-1 rounded-lg border border-slate-700 px-3 py-1.5 text-slate-200 transition hover:bg-white/10">
              Sign out
            </button>
          </form>
        </nav>

        {/* Mobile toggle */}
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-label={open ? "Close menu" : "Open menu"}
          aria-expanded={open}
          aria-controls="dashboard-menu"
          className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-slate-200 transition hover:bg-white/10 lg:hidden"
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

      {/* Mobile menu panel */}
      {open && (
        <div id="dashboard-menu" className="border-t border-slate-800 lg:hidden">
          <nav className="mx-auto flex max-w-6xl flex-col px-6 py-2 text-sm">
            {NAV.map(([key, label, href]) =>
              key === active ? (
                <span key={key} className="rounded-lg bg-white/10 px-2 py-2.5 font-medium">{label}</span>
              ) : (
                <Link key={key} href={href} onClick={close} className="rounded-lg px-2 py-2.5 text-slate-300 transition hover:bg-white/10">
                  {label}
                </Link>
              ),
            )}
            <div className="mt-1 flex items-center justify-between border-t border-slate-800 px-2 pb-1 pt-3">
              {email && <span className="truncate text-xs text-slate-400">{email}</span>}
              <form action={signOut}>
                <button className="rounded-lg border border-slate-700 px-3 py-1.5 text-slate-200 transition hover:bg-white/10">
                  Sign out
                </button>
              </form>
            </div>
          </nav>
        </div>
      )}
    </header>
  );
}
