// Brand-aligned chart palette. A warm forest-and-earth spread that stays in the
// Snowfolio family (greens, brass, clay, olive) instead of the default bright
// indigo/sky/violet rainbow. Ordered so the first few slices carry the most
// contrast, since most charts show only a handful of series.
export const CHART_CATEGORICAL = [
  "#205d4a", // forest (brand)
  "#4f9580", // green
  "#b98a34", // brass
  "#7fb49f", // sage
  "#c6533b", // clay
  "#33685a", // deep teal-green
  "#9aa35a", // olive
  "#d0a86b", // sand
  "#5c7d74", // muted teal-gray
  "#86604a", // cocoa
];

// Single-purpose roles for the framed charts.
export const CHART = {
  value: "#205d4a", // forest — the "you" line/area
  valueSoft: "#cfe0d7", // light sage — quiet bars
  invested: "#9c968a", // warm gray — the reference line
  benchmark: "#b98a34", // brass — the market comparison, distinct from forest
  gain: "#205d4a", // forest — credit / positive
  loss: "#c6533b", // clay — debit / negative
  grid: "#e6e1d5", // warm hairline gridlines
  axis: "#9c968a", // warm gray axis labels
  tooltipBorder: "#e2ddce", // warm tooltip border
} as const;
