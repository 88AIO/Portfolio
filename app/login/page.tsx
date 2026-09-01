"use client";

import { useEffect, useState } from "react";
import BrandMark from "@/components/BrandMark";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { MIN_AGE } from "@/lib/legal";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"signin" | "signup" | "mfa">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [mfaCode, setMfaCode] = useState("");
  const [msg, setMsg] = useState<{ text: string; tone: "error" | "info" } | null>(null);
  const [loading, setLoading] = useState(false);
  const note = (text: string, tone: "error" | "info" = "info") => setMsg({ text, tone });

  // Lands here two ways: fresh from the password form below, or bounced back by proxy.ts because
  // an already-signed-in session hasn't cleared its second factor yet (e.g. a bookmark straight to
  // /dashboard). Either way, an unmet aal2 requirement means "ask for the code," not "ask again for
  // the password" — checking on mount is what makes the bounce-back land on the right step.
  useEffect(() => {
    const supabase = createClient();
    supabase.auth.mfa.getAuthenticatorAssuranceLevel().then(({ data }) => {
      if (data && data.nextLevel === "aal2" && data.currentLevel !== data.nextLevel) {
        setMode("mfa");
      }
    });
  }, []);

  async function submitMfa(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setMsg(null);
    const supabase = createClient();
    const { data: factors, error: listError } = await supabase.auth.mfa.listFactors();
    const factor = factors?.totp.find((f) => f.status === "verified");
    if (listError || !factor) {
      note("Couldn't find your authenticator setup. Try signing in again.", "error");
      setLoading(false);
      return;
    }
    const { error } = await supabase.auth.mfa.challengeAndVerify({
      factorId: factor.id,
      code: mfaCode.trim(),
    });
    setLoading(false);
    if (error) {
      note("That code didn't match — check the time on your phone and try again.", "error");
      return;
    }
    router.push("/dashboard");
  }

  async function sendReset() {
    if (!email) {
      note("Enter your email above first, then tap Forgot password.", "error");
      return;
    }
    setLoading(true);
    setMsg(null);
    const supabase = createClient();
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/callback?next=/auth/reset`,
    });
    setLoading(false);
    if (error) note(error.message, "error");
    else note("Check your email for a link to reset your password.", "info");
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (mode === "signup" && !agreed) {
      note(`Please confirm you're ${MIN_AGE}+ and agree to the Terms and Privacy Policy.`, "error");
      return;
    }
    setLoading(true);
    setMsg(null);
    const supabase = createClient();
    if (mode === "signup") {
      // These land in auth.users.raw_user_meta_data, where the handle_new_user trigger reads them
      // into consent_log — the durable record that the age/Terms/Privacy checkbox was actually
      // checked for this specific signup, not just that an account exists.
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { min_age_confirmed: true, agreed_terms_and_privacy: true } },
      });
      if (error) {
        // Don't leak whether an email is already registered (account enumeration). Surface a
        // generic, actionable message for the common "already registered" case; show real errors
        // (e.g. weak password) that the user genuinely needs to act on.
        if (/registered|already|exists/i.test(error.message)) {
          note("If that email is new, check your inbox to confirm. If you already have an account, sign in instead.", "info");
        } else {
          note(error.message, "error");
        }
      } else if (data.session) {
        // Confirmation is off: they're signed in already, so glide straight into the app.
        // push() alone: /dashboard is force-dynamic, so it always renders fresh on arrival.
        // Following it with refresh() rendered the whole dashboard a second time — every query
        // twice — which is most of what made signing in feel slow.
        router.push("/dashboard");
      } else {
        note("Almost there. We sent a confirmation link to your email. Open it and you're in.", "info");
      }
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        note(error.message, "error");
      } else {
        const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
        if (aal && aal.nextLevel === "aal2" && aal.currentLevel !== aal.nextLevel) {
          setMsg(null);
          setMode("mfa");
        } else {
          // push() alone: /dashboard is force-dynamic, so it always renders fresh on arrival.
          // Following it with refresh() rendered the whole dashboard a second time — every query
          // twice — which is most of what made signing in feel slow.
          router.push("/dashboard");
        }
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
          {mode === "signin" ? "Welcome back" : mode === "signup" ? "Create your account" : "Enter your code"}
        </h1>
        <p className="mb-6 text-sm text-slate-500">
          {mode === "mfa"
            ? "Open your authenticator app and enter the current 6-digit code."
            : "Track your portfolio, dividends, and option income."}
        </p>

        {mode === "mfa" ? (
          <form onSubmit={submitMfa} className="space-y-3">
            <input
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="6-digit code"
              required
              autoFocus
              value={mfaCode}
              onChange={(e) => setMfaCode(e.target.value)}
              maxLength={6}
              className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-center text-lg tracking-[0.4em] text-slate-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200"
            />
            <button
              type="submit" disabled={loading || mfaCode.trim().length !== 6}
              className="w-full rounded-xl bg-slate-900 py-2.5 text-sm font-medium text-[#f7f4ec] shadow-sm transition hover:bg-slate-800 disabled:opacity-60"
            >
              {loading ? "…" : "Verify"}
            </button>
          </form>
        ) : (
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
                  <Link href="/legal/terms" target="_blank" rel="noopener noreferrer" className="text-indigo-600 underline">Terms</Link>{" "}
                  and{" "}
                  <Link href="/legal/privacy" target="_blank" rel="noopener noreferrer" className="text-indigo-600 underline">Privacy Policy</Link>.
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
        )}

        {msg && <p className={`mt-4 text-sm ${msg.tone === "error" ? "text-rose-600" : "text-amber-600"}`}>{msg.text}</p>}

        {mode !== "mfa" && (
          <button
            onClick={() => { setMode(mode === "signin" ? "signup" : "signin"); setMsg(null); }}
            className="mt-6 text-sm text-indigo-600 hover:underline"
          >
            {mode === "signin" ? "Need an account? Sign up" : "Have an account? Sign in"}
          </button>
        )}

        <div className="mt-6 flex justify-center gap-4 border-t border-slate-100 pt-4 text-xs text-slate-400">
          <Link href="/legal/disclaimer" className="hover:text-indigo-600">Disclaimer</Link>
          <Link href="/legal/terms" className="hover:text-indigo-600">Terms</Link>
          <Link href="/legal/privacy" className="hover:text-indigo-600">Privacy</Link>
        </div>
      </div>
    </main>
  );
}
