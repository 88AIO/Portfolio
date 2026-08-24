"use client";

import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip, Cell } from "recharts";
import { CHART } from "@/lib/chartColors";

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
          <XAxis dataKey="short" tickLine={false} axisLine={false} fontSize={11} stroke={CHART.axis} />
          <YAxis tickFormatter={fmt} tickLine={false} axisLine={false} fontSize={11} stroke={CHART.axis} width={64} />
          <Tooltip
            cursor={{ fill: "rgba(32,93,74,0.06)" }}
            formatter={(value) => [fmt(Number(value)), "Est. income"]}
            labelFormatter={(_, payload) => payload?.[0]?.payload?.label ?? ""}
            contentStyle={{ borderRadius: 12, border: `1px solid ${CHART.tooltipBorder}`, fontSize: 12 }}
          />
          <Bar dataKey="total" radius={[4, 4, 0, 0]} isAnimationActive={false}>
            {data.map((d, i) => (
              <Cell key={i} fill={i === 0 ? CHART.value : CHART.valueSoft} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
