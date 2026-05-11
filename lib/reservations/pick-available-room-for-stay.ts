import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Picks the first free room (by display_order) for a stay window.
 * Overlap rule matches iCal sync: check_in_date < other.check_out AND other.check_in < check_out_date.
 * Occupancy excludes only `cancelled` (same as `lib/ical/sync.ts`).
 */
export async function pickAvailableRoomForStay(
  supabase: SupabaseClient,
  params: {
    propertyId: string;
    roomTypes: string[];
    checkInDate: string;
    checkOutDate: string;
    excludeReservationId?: string | null;
  },
): Promise<{
  roomId: string | null;
  roomType: string | null;
  /** Physical room default keypad code from `rooms.smart_key_code`, if any. */
  roomSmartKey: string | null;
}> {
  const {
    propertyId,
    roomTypes,
    checkInDate,
    checkOutDate,
    excludeReservationId,
  } = params;

  if (roomTypes.length === 0) {
    return { roomId: null, roomType: null, roomSmartKey: null };
  }

  let q = supabase
    .from("rooms")
    .select("id, room_type, display_order, smart_key_code")
    .eq("property_id", propertyId)
    .order("display_order", { ascending: true });

  q =
    roomTypes.length === 1
      ? q.eq("room_type", roomTypes[0])
      : q.in("room_type", roomTypes);

  const { data: roomsAll, error } = await q;
  if (error || !roomsAll?.length) {
    return { roomId: null, roomType: null, roomSmartKey: null };
  }

  const candidateRoomIds = roomsAll.map((r) => r.id);
  let overlapQ = supabase
    .from("reservations")
    .select("room_id")
    .neq("status", "cancelled")
    .in("room_id", candidateRoomIds)
    .lt("check_in_date", checkOutDate)
    .gt("check_out_date", checkInDate);

  if (excludeReservationId) {
    overlapQ = overlapQ.neq("id", excludeReservationId);
  }

  const { data: overlaps } = await overlapQ;
  const occupied = new Set((overlaps ?? []).map((r) => r.room_id as string));

  const candidate = roomsAll.find((r) => !occupied.has(r.id));
  if (!candidate) {
    return { roomId: null, roomType: null, roomSmartKey: null };
  }
  const sk = (candidate as { smart_key_code?: string | null }).smart_key_code;
  return {
    roomId: candidate.id,
    roomType: candidate.room_type,
    roomSmartKey: typeof sk === "string" && sk.trim() ? sk.trim() : null,
  };
}
