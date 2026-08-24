"use client";

import { useState } from "react";
import BrandMark from "@/components/BrandMark";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { MIN_AGE } from "@/lib/legal";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function sendReset() {
    if (!email) {
      setMsg("Enter your email above first, then tap Forgot password.");
      return;
    }
    setLoading(true);
    setMsg(null);
    const supabase = createClient();
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/callback?next=/auth/reset`,
    });
    setLoading(false);
    setMsg(
      error
        ? error.message
        : "Check your email for a link to reset your password.",
    );
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (mode === "signup" && !agreed) {
      setMsg(`Please confirm you're ${MIN_AGE}+ and agree to the Terms and Privacy Policy.`);
      return;
    }
    setLoading(true);
    setMsg(null);
    const supabase = createClient();
    if (mode === "signup") {
      const { data, error } = await supabase.auth.signUp({ email, password });
      if (error) setMsg(error.message);
      else if (data.session) {
        // Confirmation is off: they're signed in already, so glide straight into the app.
        router.push("/dashboard");
        router.refresh();
      } else {
        setMsg("Almost there. We sent a confirmation link to your email. Open it and you're in.");
      }
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) setMsg(error.message);
      else {
        router.push("/dashboard");
        router.refresh();
      }
    }
    setLoading(false);
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
        <h1 className="font-display mb-1.5 text-2xl font-medium tracking-tight text-slate-900">
          {mode === "signin" ? "Welcome back" : "Create your account"}
        </h1>
        <p className="mb-6 text-sm text-slate-500">Track your portfolio, dividends, and option income.</p>

        <form onSubmit={submit} className="space-y-3">
          <input
            type="email" required placeholder="you@email.com" value={email}
            autoComplete="email"
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200"
          />
          <div className="relative">
            <input
              type={showPassword ? "text" : "password"}
              required placeholder="Password" value={password} minLength={6}
              autoComplete={mode === "signin" ? "current-password" : "new-password"}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 pr-16 text-sm text-slate-900 placeholder:text-slate-400 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200"
            />
            <button
              type="button"
              onClick={() => setShowPassword((s) => !s)}
              className="absolute inset-y-0 right-0 flex items-center px-3 text-xs font-medium text-slate-500 hover:text-slate-700"
              aria-label={showPassword ? "Hide password" : "Show password"}
            >
              {showPassword ? "Hide" : "Show"}
            </button>
          </div>
          {mode === "signup" && (
            <label className="flex items-start gap-2 pt-1 text-xs text-slate-500">
              <input
                type="checkbox"
                checked={agreed}
                onChange={(e) => setAgreed(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-400"
              />
              <span>
                I&rsquo;m {MIN_AGE} or older and agree to the{" "}
                <Link href="/legal/terms" target="_blank" className="text-indigo-600 underline">Terms</Link>{" "}
                and{" "}
                <Link href="/legal/privacy" target="_blank" className="text-indigo-600 underline">Privacy Policy</Link>.
              </span>
            </label>
          )}
          <button
            type="submit" disabled={loading}
            className="w-full rounded-xl bg-slate-900 py-2.5 text-sm font-medium text-[#f7f4ec] shadow-sm transition hover:bg-slate-800 disabled:opacity-60"
          >
            {loading ? "…" : mode === "signin" ? "Sign in" : "Sign up"}
          </button>
          {mode === "signin" && (
            <button
              type="button"
              onClick={sendReset}
              disabled={loading}
              className="w-full text-center text-xs text-slate-500 hover:text-slate-700 disabled:opacity-60"
            >
              Forgot password?
            </button>
          )}
        </form>

        {msg && <p className="mt-4 text-sm text-amber-600">{msg}</p>}

        <button
          onClick={() => { setMode(mode === "signin" ? "signup" : "signin"); setMsg(null); }}
          className="mt-6 text-sm text-indigo-600 hover:underline"
        >
          {mode === "signin" ? "Need an account? Sign up" : "Have an account? Sign in"}
        </button>

        <div className="mt-6 flex justify-center gap-4 border-t border-slate-100 pt-4 text-xs text-slate-400">
          <Link href="/legal/disclaimer" className="hover:text-indigo-600">Disclaimer</Link>
          <Link href="/legal/terms" className="hover:text-indigo-600">Terms</Link>
          <Link href="/legal/privacy" className="hover:text-indigo-600">Privacy</Link>
        </div>
      </div>
    </main>
  );
}
