import { addDays, differenceInCalendarDays, format, parseISO } from "date-fns";
import { createServiceRoleSupabase } from "@/lib/supabase/service-role";
import {
  computePublicAvailabilityByDate,
  type PublicReservationRow,
  type PublicRoomRow,
} from "@/lib/availability/public-availability";
import { buildPublicListPriceForDate } from "@/lib/availability/public-catalog-pricing";
import { resolvePublicAvailabilityCap } from "@/lib/availability/public-inventory-caps";
import { hasListPriceRule } from "@/lib/availability/public-rate-rules";
import {
  fetchSeasonalRoomRatesForWindow,
  pickBestSeasonalRateForDate,
} from "@/lib/availability/seasonal-room-rates";
import type {
  PublicInventoryCapRow,
  PublicRoomSettingRow,
} from "@/lib/types/public-catalog";
import {
  pendingUnassignedMatchAndClause,
  resolveDbRoomTypesForBooking,
} from "@/lib/reservations/room-types-for-booking";

type PropertyRow = { id: string; code: string };

function resolveRoomTypesForFilter(
  propertyCode: string,
  roomTypeParam: string,
): string[] {
  return resolveDbRoomTypesForBooking(propertyCode, roomTypeParam);
}

/**
 * Same availability + pricing stack as `/api/public/create-checkout-session`
 * (rooms, reservations, seasonal + public_room_settings list prices, inventory caps).
 */
export async function loadPublicStayAvailability(params: {
  propertyCode: string;
  roomType: string;
  checkInDate: string;
  checkOutDate: string;
  adults: number;
  children: number;
}): Promise<{
  prop: PropertyRow;
  nights: number;
  guestCount: number;
  availability: ReturnType<typeof computePublicAvailabilityByDate>;
}> {
  const { propertyCode, roomType, checkInDate, checkOutDate, adults, children } =
    params;
  const guestCount = Math.max(1, adults + children);
  const nights = differenceInCalendarDays(
    parseISO(`${checkOutDate}T00:00:00`),
    parseISO(`${checkInDate}T00:00:00`),
  );

  const supabase = createServiceRoleSupabase();

  const { data: prop, error: propErr } = await supabase
    .from("properties")
    .select("id, code")
    .eq("code", propertyCode)
    .maybeSingle();
  if (propErr || !prop) {
    throw new Error("Unknown propertyCode");
  }

  const p = prop as PropertyRow;
  const roomTypesFilter = resolveRoomTypesForFilter(p.code, roomType);
  const unassignedPart = pendingUnassignedMatchAndClause(p.id, roomTypesFilter);

  let roomsQ = supabase
    .from("rooms")
    .select("id, property_id, room_type, room_number, display_order")
    .eq("property_id", p.id);
  roomsQ =
    roomTypesFilter.length === 1
      ? roomsQ.eq("room_type", roomTypesFilter[0])
      : roomsQ.in("room_type", roomTypesFilter);

  const { data: roomsRaw, error: roomsErr } = await roomsQ.returns<PublicRoomRow[]>();
  if (roomsErr) throw new Error("Failed to load rooms");
  const rooms = roomsRaw ?? [];
  const roomIds = rooms.map((r) => r.id);

  const lastNight = format(
    addDays(parseISO(`${checkInDate}T12:00:00`), nights - 1),
    "yyyy-MM-dd",
  );

  const { data: reservationsRaw, error: resErr } = await supabase
    .from("reservations")
    .select(
      "room_id, requested_room_type, requested_property_id, check_in_date, check_out_date, status",
    )
    .in("status", ["confirmed", "checked_in", "blocked", "manual"])
    .lte("check_in_date", lastNight)
    .gt("check_out_date", checkInDate)
    .or(
      roomIds.length > 0
        ? [`room_id.in.(${roomIds.join(",")})`, unassignedPart].join(",")
        : unassignedPart,
    )
    .returns<PublicReservationRow[]>();
  if (resErr) throw new Error("Failed to load reservations");
  const reservations = reservationsRaw ?? [];

  const [rsRes, icRes, seasonalRows] = await Promise.all([
    supabase
      .from("public_room_settings")
      .select("*")
      .eq("property_code", p.code)
      .eq("room_type", roomType)
      .maybeSingle(),
    supabase
      .from("public_inventory_caps")
      .select("*")
      .eq("property_code", p.code)
      .eq("room_type", roomType),
    fetchSeasonalRoomRatesForWindow(supabase, {
      propertyCode: p.code,
      roomType,
      startYmd: checkInDate,
      endYmd: lastNight,
    }),
  ]);

  const dbRoomSetting = (rsRes.data as PublicRoomSettingRow | null) ?? null;
  const dbInventoryCaps = (icRes.data as PublicInventoryCapRow[] | null) ?? [];

  const hasDbPrice = dbRoomSetting !== null && dbRoomSetting.is_active === true;
  const hasCodePrice = !hasDbPrice && hasListPriceRule(p.code, roomType);
  const hasSeasonal = seasonalRows.length > 0;
  const listPriceForDate =
    hasDbPrice || hasCodePrice || hasSeasonal
      ? buildPublicListPriceForDate({
          propertyCode: p.code,
          roomType,
          dbRoomSetting,
          seasonalRows,
        })
      : undefined;

  const availabilityCap = resolvePublicAvailabilityCap(
    p.code,
    roomType,
    roomTypesFilter,
    guestCount,
    dbInventoryCaps,
  );

  const availabilityCapForDate = (dateYmd: string) => {
    const o = pickBestSeasonalRateForDate(seasonalRows, dateYmd)?.inventory_cap_override;
    if (o != null && Number.isFinite(o) && o >= 0) return o;
    return null;
  };

  const body = computePublicAvailabilityByDate(
    checkInDate,
    nights,
    guestCount,
    rooms,
    reservations,
    {
      ...(listPriceForDate ? { listPriceForDate } : {}),
      ...(availabilityCap != null ? { availabilityCap } : {}),
      availabilityCapForDate,
    },
  );

  return { prop: p, nights, guestCount, availability: body };
}
