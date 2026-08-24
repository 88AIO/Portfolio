"use client";

import { useState } from "react";
import { deleteAccount } from "@/app/dashboard/settings/actions";

// Danger-zone control: reveals a confirm step and only enables deletion once the user types
// DELETE, so an account (and all its data) can't be wiped by a stray click.
export default function DeleteAccountButton() {
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState("");
  const [pending, setPending] = useState(false);

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
        await deleteAccount(fd);
        // On success the action redirects; if it returns, re-enable.
        setPending(false);
      }}
      className="space-y-3"
    >
      <p className="text-sm text-slate-600">
        This permanently deletes your account and all of your holdings, transactions, and settings.
        It can&apos;t be undone. Type <span className="font-semibold text-slate-900">DELETE</span> to confirm.
      </p>
      <input
        name="confirm"
        value={confirm}
        onChange={(e) => setConfirm(e.target.value)}
        placeholder="DELETE"
        autoComplete="off"
        className="w-full max-w-xs rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm outline-none focus:border-rose-400 focus:ring-2 focus:ring-rose-200"
      />
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={confirm !== "DELETE" || pending}
          className="rounded-xl bg-rose-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-rose-700 disabled:opacity-50"
        >
          {pending ? "Deleting…" : "Permanently delete"}
        </button>
        <button
          type="button"
          onClick={() => { setOpen(false); setConfirm(""); }}
          disabled={pending}
          className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
