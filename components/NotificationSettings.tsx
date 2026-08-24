"use client";

import { useState, useTransition } from "react";
import { updateNotificationPrefs, sendTestEmail } from "@/app/dashboard/options/actions";

// Two opt-in email toggles: daily options/dividend alerts and a weekly income digest.
// Auto-saves on change (no separate Save button) for a calm, low-friction feel.
export default function NotificationSettings({
  initial,
}: {
  initial: { email_alerts: boolean; email_digest: boolean };
}) {
  const [alerts, setAlerts] = useState(initial.email_alerts);
  const [digest, setDigest] = useState(initial.email_digest);
  const [saved, setSaved] = useState(false);
  const [testing, startTest] = useTransition();
  const [testMsg, setTestMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function save(next: { alerts: boolean; digest: boolean }) {
    const fd = new FormData();
    if (next.alerts) fd.set("email_alerts", "on");
    if (next.digest) fd.set("email_digest", "on");
    setSaved(false);
    await updateNotificationPrefs(fd);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <div className="space-y-3">
      <Toggle
        label="Options & dividend alerts"
        hint="A heads-up when an option may be assigned or is about to expire, and before an ex-dividend date."
        checked={alerts}
        onChange={(v) => { setAlerts(v); save({ alerts: v, digest }); }}
      />
      <Toggle
        label="Weekly income digest"
        hint="Every week: premium and dividends collected, plus what's coming up."
        checked={digest}
        onChange={(v) => { setDigest(v); save({ alerts, digest: v }); }}
      />
      <p className="text-xs text-slate-400">
        Emails go to your account address. {saved ? <span className="text-emerald-600">Saved.</span> : "Off by default."}
      </p>

      <div className="border-t border-slate-100 pt-3">
        <button
          type="button"
          onClick={() =>
            startTest(async () => {
              setTestMsg(null);
              const res = await sendTestEmail();
              setTestMsg({ ok: res.ok, text: res.message });
            })
          }
          disabled={testing}
          className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-60"
        >
          {testing ? (
            <>
              <span className="h-3 w-3 animate-spin rounded-full border-2 border-slate-300 border-t-slate-600" />
              Sending…
            </>
          ) : (
            "Send me a test email"
          )}
        </button>
        {testMsg && (
          <p className={`mt-2 text-xs ${testMsg.ok ? "text-emerald-600" : "text-rose-600"}`}>{testMsg.text}</p>
        )}
      </div>
    </div>
  );
}

function Toggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-400"
      />
      <span>
        <span className="text-sm font-medium text-slate-700">{label}</span>
        <span className="block text-xs text-slate-400">{hint}</span>
      </span>
    </label>
  );
}
