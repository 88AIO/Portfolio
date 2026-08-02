"use client";

import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";

const COLORS = ["#6366f1", "#0ea5e9", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#14b8a6"];

export default function AllocationChart({
  data,
  currency = "USD",
}: {
  data: { name: string; value: number }[];
  currency?: string;
}) {
  return (
    <div className="h-56 w-full">
      <ResponsiveContainer>
        <PieChart>
          <Pie data={data} dataKey="value" nameKey="name" innerRadius={50} outerRadius={80} paddingAngle={2}>
            {data.map((_, i) => (
              <Cell key={i} fill={COLORS[i % COLORS.length]} />
            ))}
          </Pie>
          <Tooltip formatter={(value) => Number(value).toLocaleString("en-US", { style: "currency", currency })} />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}
