"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import BrandMark from "@/components/BrandMark";
import { createClient } from "@/lib/supabase/client";

// Where a password-recovery link lands (via /auth/callback, which exchanges the code for a
// session first). If there's a valid recovery session, let the user set a new password.
export default function ResetPasswordPage() {
  const router = useRouter();
  const [ready, setReady] = useState<"checking" | "ok" | "nosession">("checking");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth
      .getUser()
      .then(({ data }) => setReady(data.user ? "ok" : "nosession"))
      .catch(() => setReady("nosession"));
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 6) return setMsg("Use at least 6 characters.");
    if (password !== confirm) return setMsg("Those passwords don't match.");
    setLoading(true);
    setMsg(null);
    const supabase = createClient();
    const { error } = await supabase.auth.updateUser({ password });
    setLoading(false);
    if (error) return setMsg(error.message);
    router.push("/dashboard");
    router.refresh();
  }

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#f7f4ec] px-4">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-[-16rem] h-[34rem] bg-[radial-gradient(52rem_32rem_at_50%_0%,rgba(32,93,74,0.10),transparent_70%)]"
      />
      <div className="relative w-full max-w-sm rounded-3xl border border-slate-200 bg-white p-8 shadow-[0_1px_0_rgba(0,0,0,0.02),0_24px_48px_-28px_rgba(23,63,51,0.30)]">
        <div className="mb-7 flex items-center gap-2.5">
          <BrandMark className="h-8 w-8" />
          <span className="text-lg font-semibold tracking-tight text-slate-900">Snowfolio</span>
        </div>
        <h1 className="font-display mb-1.5 text-2xl font-medium tracking-tight text-slate-900">Set a new password</h1>

        {ready === "nosession" ? (
          <>
            <p className="mb-6 text-sm text-slate-500">
              This reset link has expired or was already used. Request a fresh one from the sign-in
              screen.
            </p>
            <Link
              href="/login"
              className="inline-flex w-full items-center justify-center rounded-xl bg-slate-900 py-2.5 text-sm font-medium text-[#f7f4ec] hover:bg-slate-800"
            >
              Back to sign in
            </Link>
          </>
        ) : (
          <>
            <p className="mb-6 text-sm text-slate-500">Choose a new password for your account.</p>
            <form onSubmit={submit} className="space-y-3">
              <div className="relative">
                <input
                  type={show ? "text" : "password"}
                  required
                  minLength={6}
                  placeholder="New password"
                  value={password}
                  autoComplete="new-password"
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 pr-16 text-sm text-slate-900 placeholder:text-slate-400 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200"
                />
                <button
                  type="button"
                  onClick={() => setShow((s) => !s)}
                  aria-label={show ? "Hide password" : "Show password"}
                  className="absolute inset-y-0 right-0 flex items-center px-3 text-xs font-medium text-slate-500 hover:text-slate-700"
                >
                  {show ? "Hide" : "Show"}
                </button>
              </div>
              <input
                type={show ? "text" : "password"}
                required
                minLength={6}
                placeholder="Confirm new password"
                value={confirm}
                autoComplete="new-password"
                onChange={(e) => setConfirm(e.target.value)}
                className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200"
              />
              <button
                type="submit"
                disabled={loading || ready === "checking"}
                className="w-full rounded-xl bg-slate-900 py-2.5 text-sm font-medium text-[#f7f4ec] shadow-sm transition hover:bg-slate-800 disabled:opacity-60"
              >
                {loading ? "Saving…" : "Save new password"}
              </button>
            </form>
          </>
        )}

        {msg && <p className="mt-4 text-sm text-rose-600">{msg}</p>}
      </div>
    </main>
  );
}
