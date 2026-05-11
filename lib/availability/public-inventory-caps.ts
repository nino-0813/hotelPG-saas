/**
 * Marketing / safety caps on `availableRooms` for the public availability API.
 * Physical counts stay in DB; this only clamps the number returned to the website.
 */

/**
 * Returns a maximum `availableRooms` per night for the current filter, or null for no cap.
 *
 * @param propertyCode Resolved property `code` (e.g. PG1), or null in aggregate mode
 * @param roomTypeQuery Original `roomType` query param (used for PG1/PG2 matching)
 * @param roomTypesFilter Resolved DB `room_type` list (PG3 aliases expanded)
 * @param partySize adults + children (affects PG3 combined cap when only 4-cap rooms apply)
 */
export function resolvePublicAvailabilityCap(
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
