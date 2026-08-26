"use client";

// Lazy entry points for the recharts-based charts. Recharts is the heaviest client dependency
// (~100KB gzipped) and a direct import compiles a full copy into every route chunk that renders a
// chart; loading the charts client-side after first paint keeps it out of every page's critical
// path (the dashboard's other visuals — AllocBars, tiles — are plain divs and render immediately).
// Each placeholder matches its chart's rendered height so nothing shifts when the chart pops in.
import dynamic from "next/dynamic";

function placeholder(heightClass: string) {
  return function ChartPlaceholder() {
    return <div className={`${heightClass} w-full animate-pulse rounded-lg bg-slate-100/80`} />;
  };
}

export const AllocationChart = dynamic(() => import("@/components/AllocationChart"), {
  ssr: false,
  loading: placeholder("h-56"),
});

export const PerformanceChart = dynamic(() => import("@/components/PerformanceChart"), {
  ssr: false,
  loading: placeholder("h-72"),
});

export const MonthlyPremiumChart = dynamic(() => import("@/components/MonthlyPremiumChart"), {
  ssr: false,
  loading: placeholder("h-56"),
});

export const DividendCalendarChart = dynamic(() => import("@/components/DividendCalendarChart"), {
  ssr: false,
  loading: placeholder("h-56"),
});
