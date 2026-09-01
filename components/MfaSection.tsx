"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Factor = { id: string; status: "verified" | "unverified"; friendly_name?: string };

// Two-factor authentication (TOTP) — enroll, confirm, and remove an authenticator-app factor.
// Supabase's MFA API does the actual crypto; this just walks a person through it. The one thing
// worth explaining: a factor exists in "unverified" state the instant enroll() is called, before
// anyone has proven they can generate a code from it. Left alone, a second enroll attempt errors
// on the abandoned one — so starting over always clears any unverified leftover first.
export default function MfaSection() {
  const supabase = createClient();
  const [factors, setFactors] = useState<Factor[]>([]);
  const [loading, setLoading] = useState(true);
  const [enrolling, setEnrolling] = useState<{ factorId: string; qr: string; secret: string } | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; tone: "error" | "info" } | null>(null);

  async function refresh() {
    const { data, error } = await supabase.auth.mfa.listFactors();
    if (!error) setFactors(data.totp);
    setLoading(false);
  }

  useEffect(() => {
    supabase.auth.mfa.listFactors().then(({ data, error }) => {
      if (!error) setFactors(data.totp);
      setLoading(false);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const verified = factors.find((f) => f.status === "verified");

  async function startEnroll() {
    setMsg(null);
    setBusy(true);
    // Clear any abandoned unverified factor from a previous attempt — enroll() errors if one
    // already exists under the same friendly name.
    for (const f of factors.filter((f) => f.status === "unverified")) {
      await supabase.auth.mfa.unenroll({ factorId: f.id });
    }
    const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp" });
    setBusy(false);
    if (error) {
      setMsg({ text: error.message, tone: "error" });
      return;
    }
    setEnrolling({ factorId: data.id, qr: data.totp.qr_code, secret: data.totp.secret });
  }

  async function confirmEnroll(e: React.FormEvent) {
    e.preventDefault();
    if (!enrolling) return;
    setBusy(true);
    setMsg(null);
    const { error } = await supabase.auth.mfa.challengeAndVerify({
      factorId: enrolling.factorId,
      code: code.trim(),
    });
    setBusy(false);
    if (error) {
      setMsg({ text: "That code didn't match — check the time on your phone and try again.", tone: "error" });
      return;
    }
    setEnrolling(null);
    setCode("");
    setMsg({ text: "Two-factor authentication is on.", tone: "info" });
    await refresh();
  }

  async function cancelEnroll() {
    if (enrolling) await supabase.auth.mfa.unenroll({ factorId: enrolling.factorId });
    setEnrolling(null);
    setCode("");
    setMsg(null);
  }

  async function turnOff() {
    if (!verified) return;
    if (!confirm("Turn off two-factor authentication? Signing in will only need your password.")) return;
    setBusy(true);
    setMsg(null);
    const { error } = await supabase.auth.mfa.unenroll({ factorId: verified.id });
    setBusy(false);
    if (error) {
      setMsg({ text: error.message, tone: "error" });
      return;
    }
    setMsg({ text: "Two-factor authentication is off.", tone: "info" });
    await refresh();
  }

  if (loading) return null;

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-soft">
      <h2 className="text-base font-semibold">Two-factor authentication</h2>
      <p className="mt-1 mb-4 text-sm text-slate-500">
        Your brokerage data is a real target. An authenticator app adds a second code, generated on
        your phone, that a stolen password alone can&apos;t produce.
      </p>

      {!enrolling && verified && (
        <div className="flex items-center justify-between gap-3 rounded-xl bg-emerald-50 px-4 py-3">
          <p className="text-sm font-medium text-emerald-800">On — an authenticator app is confirmed.</p>
          <button
            onClick={turnOff}
            disabled={busy}
            className="rounded-lg border border-rose-200 px-3 py-1.5 text-xs font-medium text-rose-600 hover:bg-rose-50 disabled:opacity-60"
          >
            Turn off
          </button>
        </div>
      )}

      {!enrolling && !verified && (
        <button
          onClick={startEnroll}
          disabled={busy}
          className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
        >
          Set up an authenticator app
        </button>
      )}

      {enrolling && (
        <form onSubmit={confirmEnroll} className="space-y-4">
          <p className="text-sm text-slate-600">
            Scan this with Google Authenticator, 1Password, or any TOTP app — then enter the 6-digit
            code it shows to confirm.
          </p>
          {/* eslint-disable-next-line @next/next/no-img-element -- Supabase returns a data: URI SVG, not a static asset Next's optimizer can process. */}
          <img src={enrolling.qr} alt="Authenticator QR code" className="h-40 w-40 rounded-xl border border-slate-200" />
          <p className="break-all rounded-lg bg-slate-50 px-3 py-2 font-mono text-xs text-slate-500">
            Can&apos;t scan? Enter this key manually: {enrolling.secret}
          </p>
          <input
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="6-digit code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            maxLength={6}
            className="w-40 rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm tracking-widest outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200"
          />
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={busy || code.trim().length !== 6}
              className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-60"
            >
              Verify &amp; enable
            </button>
            <button
              type="button"
              onClick={cancelEnroll}
              disabled={busy}
              className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {msg && (
        <p className={`mt-3 text-sm ${msg.tone === "error" ? "text-rose-600" : "text-slate-500"}`}>{msg.text}</p>
      )}
    </section>
  );
}
