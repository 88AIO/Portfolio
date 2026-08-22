// Builds the content for the two notification types from a user's already-computed data.
// Pure functions (no DB / no I/O) so they're easy to reason about and the cron just feeds them.
import { money } from "@/lib/format";
import type { ComputedOption } from "@/lib/options";

export type PositionLite = {
  symbol: string;
  currency: string;
  shares: number;
  next_dividend_date: string | null;
  next_dividend_per_share: number | null;
  annual_div_per_share: number | null;
  div_frequency: number | null;
};

export type AlertItem = {
  dedupeKey: string; // stable per event so a daily cron never re-sends it
  severity: "warn" | "info";
  text: string;
  date: string;
};

function addDaysIso(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

// Assignment risk, near expiry (≤2d), and upcoming ex-dividends (≤3d). One item per event.
export function buildAlerts(options: ComputedOption[], positions: PositionLite[], today: string): AlertItem[] {
  const items: AlertItem[] = [];
  for (const o of options) {
    if (!o.isOpen) continue;
    if (o.status === "may_be_assigned") {
      items.push({
        dedupeKey: `assign:${o.symbol}:${o.strike}:${o.expiration}`,
        severity: "warn",
        date: o.expiration,
        text: `${o.symbol} ${money(o.strike, o.currency)} ${o.option_type} is in the money with ${o.dte}d left — may be assigned.`,
      });
    } else if (o.dte >= 0 && o.dte <= 2) {
      items.push({
        dedupeKey: `expiry:${o.symbol}:${o.strike}:${o.expiration}`,
        severity: "info",
        date: o.expiration,
        text: `${o.symbol} ${money(o.strike, o.currency)} ${o.option_type} expires in ${o.dte}d.`,
      });
    }
  }
  const in3 = addDaysIso(today, 3);
  for (const p of positions) {
    if (p.shares > 0 && p.next_dividend_date && p.next_dividend_date >= today && p.next_dividend_date <= in3) {
      const est = p.next_dividend_per_share ?? (p.annual_div_per_share && p.div_frequency ? p.annual_div_per_share / p.div_frequency : null);
      items.push({
        dedupeKey: `exdiv:${p.symbol}:${p.next_dividend_date}`,
        severity: "info",
        date: p.next_dividend_date,
        text: `${p.symbol} goes ex-dividend on ${p.next_dividend_date}${est != null ? ` (~${money(est * p.shares, p.currency)})` : ""}.`,
      });
    }
  }
  return items.sort((a, b) => a.date.localeCompare(b.date));
}

export function alertsEmailHtml(items: AlertItem[]): string {
  const rows = items
    .map((i) => {
      const dotColor = i.severity === "warn" ? "#f59e0b" : "#0ea5e9";
      return `<tr><td style="padding:8px 0;vertical-align:top;width:16px"><span style="display:inline-block;width:8px;height:8px;border-radius:999px;background:${dotColor}"></span></td>
        <td style="padding:8px 0;font-size:14px;color:#334155">${i.text}</td></tr>`;
    })
    .join("");
  return `<p style="margin:0 0 12px;color:#475569;font-size:14px">A heads-up on your options and dividends over the next few days:</p>
    <table style="width:100%;border-collapse:collapse">${rows}</table>`;
}

// --- Weekly income digest ---
export type DigestData = {
  premiumWeek: number;
  dividendsWeek: number;
  totalWeek: number;
  upcomingExDiv: { symbol: string; date: string; est: number | null; currency: string }[];
  expiringOptions: { symbol: string; text: string }[];
  base: string;
};

export function digestEmailHtml(d: DigestData): string {
  const stat = (label: string, value: string) =>
    `<div style="flex:1;min-width:140px;border:1px solid #e2e8f0;border-radius:12px;padding:12px 14px">
      <div style="font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:#94a3b8">${label}</div>
      <div style="font-size:20px;font-weight:700;margin-top:2px">${value}</div></div>`;
  const upcoming = d.upcomingExDiv.length
    ? `<h2 style="font-size:14px;margin:20px 0 8px">Upcoming ex-dividends</h2><ul style="margin:0;padding-left:18px;color:#334155;font-size:14px">${d.upcomingExDiv
        .map((u) => `<li>${u.symbol} — ${u.date}${u.est != null ? ` (~${money(u.est, u.currency)})` : ""}</li>`)
        .join("")}</ul>`
    : "";
  const expiring = d.expiringOptions.length
    ? `<h2 style="font-size:14px;margin:20px 0 8px">Options expiring this week</h2><ul style="margin:0;padding-left:18px;color:#334155;font-size:14px">${d.expiringOptions
        .map((e) => `<li>${e.text}</li>`)
        .join("")}</ul>`
    : "";
  return `<p style="margin:0 0 16px;color:#475569;font-size:14px">Here's your income for the past week:</p>
    <div style="display:flex;gap:10px;flex-wrap:wrap">
      ${stat(`Total income (${d.base})`, money(d.totalWeek, d.base))}
      ${stat("Option premium", money(d.premiumWeek, d.base))}
      ${stat("Dividends", money(d.dividendsWeek, d.base))}
    </div>${upcoming}${expiring}`;
}
