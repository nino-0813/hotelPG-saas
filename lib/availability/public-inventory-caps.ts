import type { PublicRoomSettingRow } from "@/lib/types/public-catalog";

/**
 * Code fallback cap when `public_room_settings` has no active row for this room type.
 * Physical counts stay in DB; this only clamps the number returned to the website.
 */
export function resolveFallbackPublicAvailabilityCap(
  propertyCode: string | null,
  roomTypeQuery: string | null,
): number | null {
  if (!propertyCode || !roomTypeQuery) return null;

  const rt = roomTypeQuery.toLowerCase();

  if (propertyCode === "PG1" && rt === "standard") return 3;
  if (propertyCode === "PG2" && rt === "single") return 1;
  if (propertyCode === "PG2" && rt === "family") return 2;
  if (propertyCode === "PG3" && rt === "washitsu_modern_4") return 1;
  if (propertyCode === "PG3" && rt === "washitsu_modern_3") return 9;

  return null;
}

/**
 * Sellable room count for a stay: sourced directly from `public_room_settings.inventory_cap`
 * (the single admin-managed value for this property_code + room_type), so the admin's
 * "部屋タイプ" screen is the sole source of truth. Falls back to a hardcoded value only
 * when there's no active row in the DB yet.
 */
export function resolvePublicAvailabilityCap(
  propertyCode: string | null,
  roomTypeQuery: string | null,
  dbRoomSetting: PublicRoomSettingRow | null,
): number | null {
  if (
    dbRoomSetting &&
    dbRoomSetting.is_active &&
    dbRoomSetting.property_code === propertyCode &&
    dbRoomSetting.room_type === roomTypeQuery
  ) {
    return dbRoomSetting.inventory_cap;
  }

  return resolveFallbackPublicAvailabilityCap(propertyCode, roomTypeQuery);
}
