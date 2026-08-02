export function money(n: number | null | undefined, ccy = "USD") {
  if (n == null || isNaN(n)) return "—";
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: ccy }).format(n);
  } catch {
    return `${ccy} ${n.toFixed(2)}`;
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
