// Today as YYYY-MM-DD in UTC — THE one definition (this file replaced seven scattered copies, five
// of which used local time). UTC is deliberate: it matches production (Vercel runs UTC), every cron
// window, and keeps dedupe keys stable. In local dev evenings a "today" may differ from your wall
// clock by one day; that's the accepted cost of one consistent semantic.
export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

// True only for a real YYYY-MM-DD calendar date. Guards the NOT NULL date columns from a malformed
// string (which would otherwise throw an unhandled 500 instead of being rejected cleanly). Kept in a
// plain module (not a "use server" file, which may only export async functions).
export function isValidYmd(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}
