"use client";

import { useFormStatus } from "react-dom";

// A submit button that disables itself and shows pending text while its parent <form action=…>
// is in flight — so a slow server action (e.g. the up-to-60s price refresh) can't be double-fired
// by an impatient click, and the user gets clear feedback that something is happening.
export default function SubmitButton({
  children,
  pendingText,
  className,
}: {
  children: React.ReactNode;
  pendingText?: string;
  className?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending}
      className={`${className ?? ""} disabled:opacity-60 disabled:cursor-not-allowed`}
    >
      {pending ? pendingText ?? "Working…" : children}
    </button>
  );
}
