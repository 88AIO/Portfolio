// The shape every form-facing Server Action returns.
//
// Actions used to `throw new Error("Enter a quantity greater than zero.")` and the forms caught it —
// but Next.js redacts a thrown Error's message from Server Actions in production (it could carry
// anything from a stack trace to a database error), so the browser received a generic digest and
// every form printed the same "Couldn't add that" no matter what was wrong. A trade date typed as
// 2024-13-40 got the same message as a network outage. Returning the message as data keeps it
// user-visible; the forms still catch a genuine throw as the unexpected case it is.
export type ActionResult = { ok: true } | { ok: false; error: string };

export const ok: ActionResult = { ok: true };
export function fail(error: string): ActionResult {
  return { ok: false, error };
}
