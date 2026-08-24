import Link from "next/link";
import { APP_NAME } from "@/lib/legal";

// Wraps every dashboard page with a slim footer carrying the not-advice disclaimer and legal links,
// so they're reachable from anywhere in the app.
export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <footer className="border-t border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-4 gap-y-2 px-6 py-4 text-xs text-slate-400">
          <span>
            {APP_NAME} is informational only — not financial advice.{" "}
            <Link href="/legal/disclaimer" className="underline hover:text-slate-600">Disclaimer</Link>
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
