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

/**
 * Applies when `start_date <= dateYmd <= end_date`.
 * If multiple rows match, the row with the **largest** `priority` wins.
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
  matches.sort((a, b) => b.priority - a.priority);
  return matches[0] ?? null;
}
