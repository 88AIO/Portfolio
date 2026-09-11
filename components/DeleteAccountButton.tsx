"use client";

import { useState } from "react";
import { deleteAccount } from "@/app/dashboard/settings/actions";

// Danger-zone control: reveals a confirm step and only enables deletion once the user types
// DELETE, so an account (and all its data) can't be wiped by a stray click.
export default function DeleteAccountButton() {
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="rounded-xl border border-rose-300 px-4 py-2 text-sm font-medium text-rose-700 transition hover:bg-rose-50"
      >
        Delete my account
      </button>
    );
  }

  return (
    <form
      action={async (fd) => {
        setPending(true);
        setError(null);
        try {
          const r = await deleteAccount(fd);
          // On success the action redirects and never returns here.
          if (r && !r.ok) setError(r.error);
        } catch {
          setError("We couldn't delete the account just now. Nothing was changed — please try again.");
        } finally {
          setPending(false);
        }
      }}
      className="space-y-3"
    >
      <p className="text-sm text-slate-600">
        This permanently deletes your account and all of your holdings, transactions, and settings.
        It can&apos;t be undone. Enter your password and type{" "}
        <span className="font-semibold text-slate-900">DELETE</span> to confirm.
      </p>
      <input
        name="password"
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="Current password"
        aria-label="Current password"
        autoComplete="current-password"
        className="w-full max-w-xs rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm outline-none focus:border-rose-400 focus:ring-2 focus:ring-rose-200"
      />
      <input
        name="confirm"
        value={confirm}
        onChange={(e) => setConfirm(e.target.value)}
        placeholder="DELETE"
        aria-label="Type DELETE to confirm"
        autoComplete="off"
        className="w-full max-w-xs rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm outline-none focus:border-rose-400 focus:ring-2 focus:ring-rose-200"
      />
      {error && <p role="alert" className="text-xs text-rose-600">{error}</p>}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={confirm !== "DELETE" || !password || pending}
          className="rounded-xl bg-rose-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-rose-700 disabled:opacity-50"
        >
          {pending ? "Deleting…" : "Permanently delete"}
        </button>
        <button
          type="button"
          onClick={() => { setOpen(false); setConfirm(""); setPassword(""); setError(null); }}
          disabled={pending}
          className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
