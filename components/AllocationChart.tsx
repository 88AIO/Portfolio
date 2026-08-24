"use client";

import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";
import { CHART_CATEGORICAL as COLORS } from "@/lib/chartColors";

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
          <Pie data={data} dataKey="value" nameKey="name" innerRadius={50} outerRadius={80} paddingAngle={2} isAnimationActive={false}>
            {data.map((_, i) => (
              <Cell key={i} fill={COLORS[i % COLORS.length]} />
            ))}
          </Pie>
          <Tooltip
            formatter={(value) => Number(value).toLocaleString("en-US", { style: "currency", currency })}
            contentStyle={{ borderRadius: 12, border: "1px solid #e2ddce", fontSize: 12 }}
          />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}
