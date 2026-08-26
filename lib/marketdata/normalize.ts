// Vendor-agnostic normalization shared by every market-data provider.
// These are product decisions, not vendor details: what currency a price is really in, and what a
// sector is called. They live here so two providers can never drift apart on the same question —
// the failure mode that produced two hand-edited FX fallback tables (see docs/EFFICIENCY_AUDIT.md).

// Some exchanges quote in a minor unit: LSE in pence (GBp), JSE in cents (ZAc), TASE in agorot
// (ILa). Taken at face value a price is 100x too large. Normalize to the major ISO unit (÷100) so
// prices, dividends, and FX all agree.
const MINOR_UNIT: Record<string, string> = { GBP: "GBP", GBX: "GBP", ZAC: "ZAR", ILA: "ILS" };

export function normalizeCurrency(raw: string | null | undefined): { currency: string; divisor: number } {
  if (!raw) return { currency: "USD", divisor: 1 };
  // The tell for a minor-unit quote is a lowercase trailing letter (GBp, ZAc, ILa) — except GBX,
  // which vendors write in caps.
  const upper = raw.toUpperCase();
  const isMinor = (/[a-z]$/.test(raw) || upper === "GBX") && MINOR_UNIT[upper] != null;
  if (isMinor) return { currency: MINOR_UNIT[upper], divisor: 100 };
  return { currency: upper, divisor: 1 };
}

// One canonical sector vocabulary. The dashboard sums sector weights ACROSS instruments, so a
// provider that says "Consumer Cyclicals" where another says "Consumer Cyclical" would split one
// slice into two. Every provider maps its own labels through here.
export const CANONICAL_SECTOR: Record<string, string> = {
  // Yahoo's fund-breakdown keys (lowercase, underscored)
  realestate: "Real Estate",
  consumer_cyclical: "Consumer Cyclical",
  basic_materials: "Basic Materials",
  consumer_defensive: "Consumer Defensive",
  technology: "Technology",
  communication_services: "Communication Services",
  financial_services: "Financial Services",
  utilities: "Utilities",
  industrials: "Industrials",
  energy: "Energy",
  healthcare: "Healthcare",
  // EODHD's ETF Sector_Weights keys (Title Case, occasionally pluralised)
  "real estate": "Real Estate",
  "consumer cyclical": "Consumer Cyclical",
  "consumer cyclicals": "Consumer Cyclical",
  "basic materials": "Basic Materials",
  "consumer defensive": "Consumer Defensive",
  "communication services": "Communication Services",
  "financial services": "Financial Services",
  "financial": "Financial Services",
  "health care": "Healthcare",
};

// Map any vendor's sector label to the canonical one; unknown labels pass through unchanged so a
// new sector shows up honestly rather than being silently dropped.
export function canonicalSector(raw: string): string {
  return CANONICAL_SECTOR[raw] ?? CANONICAL_SECTOR[raw.toLowerCase()] ?? raw;
}
