import DeleteActivityButton from "@/components/DeleteActivityButton";
import { money } from "@/lib/format";

// One activity row, shared by the three sections on a holding page (options, dividends, share
// trades). They used to be a single mixed timeline; the markup stayed in one place when they split
// so a change to how a row looks doesn't have to be made three times and get made twice.

export type ActivityItem = {
  id: string;
  source: "tx" | "option";
  date: string;
  kind: "buy" | "sell" | "dividend" | "option";
  title: string;
  detail: string;
  /** Cash flow in the instrument's currency (+ in, − out). */
  amount: number | null;
  portfolio: string;
  /** Small tag after the title, e.g. DRIP. */
  badge?: string;
  badgeTitle?: string;
};

function dot(kind: ActivityItem["kind"]): string {
  return kind === "buy"
    ? "bg-[#4f9580]"
    : kind === "sell"
      ? "bg-slate-400"
      : kind === "dividend"
        ? "bg-emerald-500"
        : "bg-[#b98a34]";
}

export default function ActivityList({
  items,
  instrumentId,
  currency,
  empty,
}: {
  items: ActivityItem[];
  instrumentId: string;
  currency: string;
  empty: string;
}) {
  if (!items.length) {
    return <p className="py-8 text-center text-sm text-slate-400">{empty}</p>;
  }
  return (
    <ul className="space-y-1">
      {items.map((item) => (
        <li
          key={`${item.source}:${item.id}`}
          className="group flex items-center justify-between gap-3 border-b border-slate-50 py-2.5 last:border-0"
        >
          <div className="flex items-center gap-3">
            <span className={`mt-0.5 h-2 w-2 shrink-0 rounded-full ${dot(item.kind)}`} />
            <div>
              <div className="flex items-center gap-1.5 text-sm font-medium">
                {item.title}
                {item.badge && (
                  <span
                    title={item.badgeTitle}
                    className="rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700"
                  >
                    {item.badge}
                  </span>
                )}
              </div>
              <div className="text-xs text-slate-400">{item.detail}</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="text-right">
              {item.amount != null && (
                <div
                  className={`text-sm font-medium tabular-nums ${item.amount >= 0 ? "text-emerald-600" : "text-slate-600"}`}
                >
                  {item.amount >= 0 ? "+" : ""}
                  {money(item.amount, currency)}
                </div>
              )}
              <div className="text-xs text-slate-400">{item.date}</div>
            </div>
            <DeleteActivityButton id={item.id} instrumentId={instrumentId} source={item.source} />
          </div>
        </li>
      ))}
    </ul>
  );
}
