// Shared instrument enrichment (server-side, service role). Individual stocks get a single
// `sector` + `country_iso` from the provider's profile; ETFs/funds (which have no single
// sector) get a `sector_weights` look-through breakdown instead. Used by the price refresh
// and the broker sync so both paths classify holdings the same way.
import type { createAdminClient } from "@/lib/supabase/admin";
import { getProfile, getFundBreakdown } from "@/lib/marketdata";

type Admin = ReturnType<typeof createAdminClient>;

export async function enrichInstrumentProfile(
  admin: Admin,
  inst: { id: string; symbol: string; exchange: string; type?: string | null }
): Promise<void> {
  const profile = await getProfile(inst.symbol, inst.exchange);
  const patch: Record<string, unknown> = {};
  if (profile?.sector) patch.sector = profile.sector;
  if (profile?.country) patch.country_iso = profile.country;

  // No single sector (typical for ETFs/funds) → pull the fund's sector look-through
  // so its value can be distributed across real sectors on the allocation chart.
  if (!profile?.sector) {
    const fb = await getFundBreakdown(inst.symbol, inst.exchange);
    if (fb && fb.sectorWeights.length) {
      patch.sector_weights = fb.sectorWeights;
      if (!inst.type || inst.type === "stock") patch.type = "etf";
    }
  }

  if (Object.keys(patch).length) {
    await admin.from("instruments").update(patch).eq("id", inst.id);
  }
}
