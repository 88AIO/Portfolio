"use client";

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, ResponsiveContainer, Tooltip, Cell } from "recharts";

type Point = { month: string; premium: number };

// Monthly option-premium income. Green bars for credit months, rose for net-debit months (when
// buy-to-close / rolls cost more than was collected). Calm, at-a-glance income rhythm.
export default function MonthlyPremiumChart({ data, currency = "USD" }: { data: Point[]; currency?: string }) {
  const money = (v: number) =>
    Number(v).toLocaleString("en-US", { style: "currency", currency, maximumFractionDigits: 0 });
  const label = (m: string) => {
    const [y, mm] = m.split("-");
    return `${["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][Number(mm)]} ${y.slice(2)}`;
  };

  return (
    <div className="h-56 w-full">
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" vertical={false} />
          <XAxis dataKey="month" tickFormatter={label} tickLine={false} axisLine={false} fontSize={11} stroke="#94a3b8" minTickGap={24} />
          <YAxis tickFormatter={money} tickLine={false} axisLine={false} fontSize={11} stroke="#94a3b8" width={64} />
          <Tooltip
            formatter={(v) => [money(Number(v)), "Premium"]}
            labelFormatter={(m) => label(String(m))}
            contentStyle={{ borderRadius: 12, border: "1px solid #e2e8f0", fontSize: 12 }}
            cursor={{ fill: "rgba(148,163,184,0.08)" }}
          />
          <Bar dataKey="premium" radius={[3, 3, 0, 0]} isAnimationActive={false}>
            {data.map((d, i) => (
              <Cell key={i} fill={d.premium >= 0 ? "#10b981" : "#f43f5e"} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
