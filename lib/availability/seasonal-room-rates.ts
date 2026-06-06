import type { SupabaseClient } from "@supabase/supabase-js";
import type { PublicSeasonalRoomRateRow } from "@/lib/types/public-catalog";

/**
 * Active rows overlapping [startYmd, endYmd] for catalog `property_code` + `room_type`
 * (same keys as `public_room_settings`).
 */
export async function fetchSeasonalRoomRatesForWindow(
  supabase: SupabaseClient,
  params: {
    propertyCode: string;
    roomType: string;
    startYmd: string;
    endYmd: string;
  },
): Promise<PublicSeasonalRoomRateRow[]> {
  const { data, error } = await supabase
    .from("public_seasonal_room_rates")
    .select("*")
    .eq("property_code", params.propertyCode)
    .eq("room_type", params.roomType)
    .eq("is_active", true)
    .lte("start_date", params.endYmd)
    .gte("end_date", params.startYmd)
    .order("priority", { ascending: false })
    .returns<PublicSeasonalRoomRateRow[]>();

  if (error) {
    console.error("[seasonal-room-rates] fetch", error);
    return [];
  }
  return data ?? [];
}

/** Inclusive day span of a rate's date range (days). Larger = broader period. */
function seasonalRangeDays(r: PublicSeasonalRoomRateRow): number {
  const s = Date.parse(`${r.start_date}T00:00:00Z`);
  const e = Date.parse(`${r.end_date}T00:00:00Z`);
  if (Number.isNaN(s) || Number.isNaN(e)) return Number.POSITIVE_INFINITY;
  return Math.round((e - s) / 86_400_000);
}

/**
 * Applies when `start_date <= dateYmd <= end_date`.
 * Winner among overlapping rows, in order:
 *   1. largest `priority`
 *   2. on tie, the **narrower** date range (a specific event like お盆 beats a broad
 *      season like 夏休み when they overlap)
 *   3. on tie, the more recently created row
 *   4. on tie, deterministic by id
 *
 * Note: rows added via the staff admin UI all share the same priority (100), so the
 * "narrower range wins" rule is what makes a short event override a long season.
 */
export function pickBestSeasonalRateForDate(
  rows: PublicSeasonalRoomRateRow[],
  dateYmd: string,
): PublicSeasonalRoomRateRow | null {
  const matches = rows.filter(
    (r) =>
      r.is_active &&
      r.start_date <= dateYmd &&
      r.end_date >= dateYmd,
  );
  if (matches.length === 0) return null;
  matches.sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority;
    const da = seasonalRangeDays(a);
    const db = seasonalRangeDays(b);
    if (da !== db) return da - db; // narrower (more specific) first
    if (a.created_at !== b.created_at) return a.created_at < b.created_at ? 1 : -1; // newer first
    return a.id < b.id ? 1 : -1;
  });
  return matches[0] ?? null;
}
