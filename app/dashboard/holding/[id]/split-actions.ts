"use server";

// Recording a stock split by hand.
//
// The nightly sync fills these in from the data provider, but coverage is imperfect — a provider
// can miss a split on a thinly-covered listing, or report the wrong ratio. Since a missing split
// silently misstates cost basis and every return derived from it, the user needs a way to fix one
// without waiting on a vendor.
//
// Entries go to portfolio_splits, never to the shared instrument_splits table: one person's
// correction must not restate every other holder's position. See supabase/schema.sql.

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { syncInstrumentSplits } from "@/lib/marketdata/sync";
import { ensurePortfolio } from "../../actions";
import { parseSplitRatio, MIN_RATIO, MAX_RATIO } from "@/lib/corporate/splits";

export async function addSplit(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const portfolio = await ensurePortfolio();
  const instrumentId = String(formData.get("instrument_id") || "");
  const exDate = String(formData.get("ex_date") || "").trim();
  const ratio = parseSplitRatio(String(formData.get("ratio") || ""));
  const note = String(formData.get("note") || "").trim().slice(0, 200) || null;

  if (!instrumentId) throw new Error("Missing holding.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(exDate)) {
    throw new Error("Enter the split date as YYYY-MM-DD.");
  }
  if (ratio == null) {
    throw new Error('Enter the split as "4-for-1", "1-for-10" for a reverse split, or just "4".');
  }
  if (ratio < MIN_RATIO || ratio > MAX_RATIO) {
    throw new Error("That ratio looks like a typo. Check it and try again.");
  }

  // Upsert, so re-entering a date corrects it instead of failing on the unique constraint — the
  // user's mental model is "the split on this date is X", not "insert a row".
  const { error } = await supabase.from("portfolio_splits").upsert(
    {
      portfolio_id: portfolio.id,
      instrument_id: instrumentId,
      ex_date: exDate,
      ratio,
      note,
    },
    { onConflict: "portfolio_id,instrument_id,ex_date" }
  );
  if (error) {
    throw new Error("We couldn't save that split just now. Please try again.");
  }

  revalidateAffected(instrumentId);
}

export async function deleteSplit(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const id = String(formData.get("split_id") || "");
  const instrumentId = String(formData.get("instrument_id") || "");
  if (!id) return;

  // RLS confines this to the user's own rows, so a provider row cannot be deleted here even if
  // its id were guessed — which is the intent: shared reference data is corrected by overriding
  // it, not by removing it from under everyone else.
  const { error } = await supabase.from("portfolio_splits").delete().eq("id", id);
  if (error) {
    throw new Error("We couldn't remove that split just now. Please try again.");
  }

  revalidateAffected(instrumentId);
}

// A split moves share counts, cost basis, realized gains, the value chart and dividend-per-share
// history, so every page that reads any of those is now stale.
function revalidateAffected(instrumentId: string) {
  if (instrumentId) revalidatePath(`/dashboard/holding/${instrumentId}`);
  revalidatePath("/dashboard");
  revalidatePath("/dashboard/performance");
  revalidatePath("/dashboard/options");
  revalidatePath("/dashboard/dividends");
}

/**
 * Fetch this holding's split history from the market-data provider, now.
 *
 * The nightly sync already does this, but "now" matters twice: after a provider corrects its data
 * there is otherwise no way to pick that up before the next run, and a holding added today would
 * show an empty Splits section until tomorrow, which reads as "this stock never split" rather than
 * "we haven't looked yet".
 *
 * Reading the instrument through the user's own client IS the authorization check: the instruments
 * policy only returns rows they actually hold, so a guessed id cannot drive provider fan-out or
 * write into the shared splits table on someone else's behalf.
 */
export async function checkSplits(instrumentId: string): Promise<{ ok: boolean; message: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Please sign in again." };
  if (!instrumentId) return { ok: false, message: "Missing holding." };

  const { data: inst } = await supabase
    .from("instruments")
    .select("id, symbol, exchange")
    .eq("id", instrumentId)
    .maybeSingle();
  if (!inst) return { ok: false, message: "That holding isn't in your portfolio." };

  let written: number | null;
  try {
    // Service role: instrument_splits is shared reference data, written server-side like prices
    // and dividends. Clients only ever read it.
    written = await syncInstrumentSplits(createAdminClient(), inst.id, inst.symbol, inst.exchange);
  } catch {
    return { ok: false, message: "The market-data provider didn't answer. Try again in a minute." };
  }

  if (written === null) {
    return { ok: false, message: "Found splits but couldn't save them. Check that supabase/schema.sql has been applied." };
  }

  revalidateAffected(instrumentId);
  if (written === 0) {
    // An honest empty answer, distinct from never having asked.
    return { ok: true, message: `No splits on record for ${inst.symbol}. You can still add one below.` };
  }
  return {
    ok: true,
    message: `Found ${written} split${written === 1 ? "" : "s"} for ${inst.symbol}. Refresh to see the updated share count.`,
  };
}
