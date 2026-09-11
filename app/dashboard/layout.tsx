import type { Metadata } from "next";
import Link from "next/link";
import { APP_NAME } from "@/lib/legal";
import { getCurrentUser } from "@/lib/supabase/user";
import DashboardNav from "@/components/DashboardNav";

// Belt and braces with robots.txt and the auth redirect: nothing behind the sign-in is ever a
// search result.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

// Wraps every dashboard page with the shared header (once, so it stays put across navigations) and
// a slim footer carrying the not-advice disclaimer and legal links, so they're reachable from
// anywhere in the app. proxy.ts guarantees a signed-in user before this renders.
export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  return (
    <>
      <DashboardNav email={user?.email} />
      {children}
      <footer className="border-t border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-4 gap-y-2 px-6 py-4 text-xs text-slate-500">
          <span>
            {APP_NAME} is informational only — not financial advice.{" "}
            <Link href="/legal/disclaimer" className="underline hover:text-slate-700">Disclaimer</Link>
          </span>
          <span className="flex gap-4">
            <Link href="/legal/terms" className="hover:text-indigo-600">Terms</Link>
            <Link href="/legal/privacy" className="hover:text-indigo-600">Privacy</Link>
          </span>
        </div>
      </footer>
    </>
  );
}
