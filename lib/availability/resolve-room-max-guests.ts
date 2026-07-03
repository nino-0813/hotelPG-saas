import { createServiceRoleSupabase } from "@/lib/supabase/service-role";

/** Fallback when public_room_settings has no active row for this room type yet. */
const FALLBACK_MAX_GUESTS: Record<string, Record<string, number>> = {
  PG1: { standard: 2 },
  PG2: { single: 2, family: 4 },
  PG3: { washitsu_modern_3: 3, washitsu_modern_4: 4, maisonette_6: 6 },
};

export function fallbackMaxGuests(propertyCode: string, roomType: string): number {
  return FALLBACK_MAX_GUESTS[propertyCode]?.[roomType] ?? 4;
}

/**
 * Authoritative max guests for a property_code + room_type: sourced from
 * public_room_settings.max_guests (the admin's "部屋タイプ" screen), so a
 * capacity change there takes effect on the public site without a deploy.
 * `roomType` must already be the concrete DB room_type (resolve web aliases
 * like `family`/`standard` via `resolvePg3WebCatalogRoomType` first).
 */
export async function resolvePublicRoomMaxGuests(
  propertyCode: string,
  roomType: string,
): Promise<number> {
  try {
    const supabase = createServiceRoleSupabase();
    const { data } = await supabase
      .from("public_room_settings")
      .select("max_guests, is_active")
      .eq("property_code", propertyCode)
      .eq("room_type", roomType)
      .maybeSingle<{ max_guests: number; is_active: boolean }>();

    if (data && data.is_active && Number.isFinite(data.max_guests) && data.max_guests > 0) {
      return data.max_guests;
    }
  } catch (e) {
    console.error("[resolvePublicRoomMaxGuests]", e);
  }
  return fallbackMaxGuests(propertyCode, roomType);
}
