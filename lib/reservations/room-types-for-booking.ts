import {
  resolvePg3RoomTypesForFilter,
  resolvePg3WebCatalogRoomType,
} from "@/lib/availability/public-rate-rules";

/**
 * Web / Stripe `roomType` → DB `rooms.room_type` values.
 * PG3 `family` / `standard` with `guestCount` → single washitsu band (website / Checkout).
 * Without `guestCount`, PG3 `family` / `standard` still expands to both (iCal / legacy).
 */
export function resolveDbRoomTypesForBooking(
  propertyCode: string,
  channelRoomType: string,
  guestCount?: number,
): string[] {
  if (propertyCode === "PG3") {
    const v = channelRoomType.toLowerCase();
    if (
      (v === "family" || v === "standard") &&
      guestCount !== undefined
    ) {
      return [
        resolvePg3WebCatalogRoomType(propertyCode, channelRoomType, guestCount),
      ];
    }
    return resolvePg3RoomTypesForFilter(channelRoomType);
  }
  return [channelRoomType];
}

/** PostgREST `and(...)` fragment: unassigned rows for this property + room-type band. */
export function pendingUnassignedMatchAndClause(
  propertyId: string,
  dbRoomTypes: string[],
): string {
  const rt =
    dbRoomTypes.length === 1
      ? `requested_room_type.eq.${dbRoomTypes[0]}`
      : `requested_room_type.in.(${dbRoomTypes.join(",")})`;
  return `and(room_id.is.null,requested_property_id.eq.${propertyId},${rt})`;
}
