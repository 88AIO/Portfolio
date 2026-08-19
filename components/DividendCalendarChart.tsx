"use client";

import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip, Cell } from "recharts";

type MonthBar = { label: string; short: string; total: number; count: number };

/** Calm monthly income bars for the next 12 months. The current month is tinted to anchor "now". */
export default function DividendCalendarChart({
  data,
  currency = "USD",
}: {
  data: MonthBar[];
  currency?: string;
}) {
  const fmt = (v: number) =>
    Number(v).toLocaleString("en-US", { style: "currency", currency, maximumFractionDigits: 0 });
  return (
    <div className="h-56 w-full">
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
          <XAxis dataKey="short" tickLine={false} axisLine={false} fontSize={11} stroke="#94a3b8" />
          <YAxis tickFormatter={fmt} tickLine={false} axisLine={false} fontSize={11} stroke="#94a3b8" width={64} />
          <Tooltip
            cursor={{ fill: "#f1f5f9" }}
            formatter={(value) => [fmt(Number(value)), "Est. income"]}
            labelFormatter={(_, payload) => payload?.[0]?.payload?.label ?? ""}
          />
          <Bar dataKey="total" radius={[4, 4, 0, 0]}>
            {data.map((d, i) => (
              <Cell key={i} fill={i === 0 ? "#6366f1" : "#c7d2fe"} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
