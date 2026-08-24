"use client";

import {
  AreaChart,
  Area,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
} from "recharts";
import { CHART } from "@/lib/chartColors";

type Point = { date: string; value: number; invested: number; benchmark?: number };

/** Value-over-time (filled) with net-invested as a reference line. Calm, two-series read. */
export default function PerformanceChart({
  data,
  currency = "USD",
}: {
  data: Point[];
  currency?: string;
}) {
  const money = (v: number) =>
    Number(v).toLocaleString("en-US", { style: "currency", currency, maximumFractionDigits: 0 });
  const hasBenchmark = data.some((d) => typeof d.benchmark === "number");
  const seriesLabel = (name: unknown) =>
    name === "value" ? "Value" : name === "benchmark" ? "S&P 500" : "Invested";
  const shortDate = (d: string) => {
    const [y, m] = d.split("-");
    return `${["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][Number(m)]} ${y.slice(2)}`;
  };

  return (
    <div className="h-72 w-full">
      <ResponsiveContainer>
        <AreaChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
          <defs>
            <linearGradient id="perfValue" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={CHART.value} stopOpacity={0.28} />
              <stop offset="100%" stopColor={CHART.value} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke={CHART.grid} vertical={false} />
          <XAxis
            dataKey="date"
            tickFormatter={shortDate}
            tickLine={false}
            axisLine={false}
            fontSize={11}
            stroke={CHART.axis}
            minTickGap={40}
          />
          <YAxis
            tickFormatter={money}
            tickLine={false}
            axisLine={false}
            fontSize={11}
            stroke={CHART.axis}
            width={68}
          />
          <Tooltip
            formatter={(v, name) => [money(Number(v)), seriesLabel(name)]}
            labelFormatter={(d) => shortDate(String(d))}
            contentStyle={{ borderRadius: 12, border: `1px solid ${CHART.tooltipBorder}`, fontSize: 12 }}
          />
          <Area
            type="monotone"
            dataKey="value"
            stroke={CHART.value}
            strokeWidth={2}
            fill="url(#perfValue)"
            name="value"
            isAnimationActive={false}
          />
          <Line
            type="monotone"
            dataKey="invested"
            stroke={CHART.invested}
            strokeWidth={1.5}
            strokeDasharray="4 4"
            dot={false}
            name="invested"
            isAnimationActive={false}
          />
          {hasBenchmark && (
            <Line
              type="monotone"
              dataKey="benchmark"
              stroke={CHART.benchmark}
              strokeWidth={2}
              dot={false}
              name="benchmark"
              isAnimationActive={false}
            />
          )}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
