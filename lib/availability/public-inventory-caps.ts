import type { PublicInventoryCapRow } from "@/lib/types/public-catalog";

/**
 * Code fallback caps when `public_inventory_caps` has no matching row.
 * Physical counts stay in DB; this only clamps the number returned to the website.
 */
export function resolveFallbackPublicAvailabilityCap(
  propertyCode: string | null,
  roomTypeQuery: string | null,
  roomTypesFilter: string[] | null,
  partySize: number,
): number | null {
  if (!propertyCode || !roomTypeQuery) return null;

  const rt = roomTypeQuery.toLowerCase();

  if (propertyCode === "PG1" && rt === "standard") return 3;
  if (propertyCode === "PG2" && rt === "single") return 1;
  if (propertyCode === "PG2" && rt === "family") return 2;

  if (propertyCode !== "PG3") return null;

  const types = roomTypesFilter ?? [];
  const has4 = types.includes("washitsu_modern_4");
  const has3 = types.includes("washitsu_modern_3");

  if (types.length === 1 && has4) return 1;
  if (types.length === 1 && has3) return 9;

  if (has3 && has4) {
    return partySize >= 4 ? 1 : 10;
  }
  if (has4) return 1;
  if (has3) return 9;

  return null;
}

/**
 * Caps `availableRooms` per night: `public_inventory_caps` first (guest band match),
 * then code fallback in {@link resolveFallbackPublicAvailabilityCap}.
 *
 * @param dbCaps Rows for this property_code + room_type query (may be empty after fetch).
 *        Pass `null` when no DB lookup was done (aggregate / unscoped mode).
 */
export function resolvePublicAvailabilityCap(
  propertyCode: string | null,
  roomTypeQuery: string | null,
  roomTypesFilter: string[] | null,
  partySize: number,
  dbCaps: PublicInventoryCapRow[] | null,
): number | null {
  if (dbCaps !== null && propertyCode && roomTypeQuery) {
    const g = partySize;
    const match = dbCaps.find(
      (c) =>
        c.property_code === propertyCode &&
        c.room_type === roomTypeQuery &&
        g >= c.min_guests &&
        g <= c.max_guests,
    );
    if (match) return match.inventory_cap;
  }

  return resolveFallbackPublicAvailabilityCap(
    propertyCode,
    roomTypeQuery,
    roomTypesFilter,
    partySize,
  );
}
