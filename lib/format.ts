// Currencies whose default Intl "symbol" is a spelled-out code (e.g. "SGD 1,234") rather than a
// glyph — give them a compact, recognizable symbol so a mixed-currency table reads cleanly.
const PREFERRED_SYMBOL: Record<string, string> = {
  SGD: "S$", MYR: "RM", CNH: "CN¥", IDR: "Rp", PHP: "₱", THB: "฿", VND: "₫",
};

export function money(n: number | null | undefined, ccy = "USD") {
  if (n == null || isNaN(n)) return "—";
  const code = (ccy || "USD").toUpperCase();
  const sym = PREFERRED_SYMBOL[code];
  if (sym) {
    const num = Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return `${n < 0 ? "-" : ""}${sym}${num}`;
  }
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: code }).format(n);
  } catch {
    return `${code} ${n.toFixed(2)}`;
  }
}

export function pct(n: number | null | undefined) {
  if (n == null || isNaN(n)) return "—";
  const s = n >= 0 ? "+" : "";
  return `${s}${n.toFixed(2)}%`;
}

export function num(n: number | null | undefined, dp = 2) {
  if (n == null || isNaN(n)) return "—";
  return n.toLocaleString("en-US", { maximumFractionDigits: dp });
}

// Relative "time ago" for honest "prices as of…" labels. Falls back to a date for old timestamps.
export function timeAgo(value: string | number | Date | null | undefined) {
  if (value == null) return "—";
  const d = new Date(value);
  const then = d.getTime();
  if (isNaN(then)) return "—";
  const sec = Math.round((Date.now() - then) / 1000);
  if (sec < 45) return "just now";
  const min = Math.round(sec / 60);
  if (min < 60) return `${min} min ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr} hour${hr === 1 ? "" : "s"} ago`;
  const day = Math.round(hr / 24);
  if (day < 30) return `${day} day${day === 1 ? "" : "s"} ago`;
  return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}
