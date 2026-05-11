import { addDays, differenceInCalendarDays, format, parseISO } from "date-fns";
import { NextResponse, type NextRequest } from "next/server";
import { createServiceRoleSupabase } from "@/lib/supabase/service-role";
import {
  computePublicAvailabilityByDate,
  type PublicReservationRow,
  type PublicRoomRow,
} from "@/lib/availability/public-availability";
import { listPriceFromRoomSetting } from "@/lib/availability/list-price-from-db-setting";
import { resolvePublicAvailabilityCap } from "@/lib/availability/public-inventory-caps";
import {
  computeListPriceForNight,
  hasListPriceRule,
} from "@/lib/availability/public-rate-rules";
import type {
  PublicInventoryCapRow,
  PublicRoomSettingRow,
} from "@/lib/types/public-catalog";
import { createStripeCheckoutSession } from "@/lib/stripe/stripe-api";
import {
  pendingUnassignedMatchAndClause,
  resolveDbRoomTypesForBooking,
} from "@/lib/reservations/room-types-for-booking";

export const runtime = "nodejs";

const corsJsonHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsJsonHeaders });
}

type CreateCheckoutBody = {
  propertyCode: string;
  roomType: string;
  checkInDate: string;
  checkOutDate: string;
  adults: number;
  children: number;
  guestName: string;
  guestEmail: string;
  guestPhone?: string | null;
  successUrl: string;
  cancelUrl: string;
};

function isValidYmd(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = parseISO(`${s}T12:00:00`);
  return !Number.isNaN(d.getTime());
}

function bad(msg: string, status = 400) {
  return NextResponse.json({ error: msg }, { status, headers: corsJsonHeaders });
}

function resolveRoomTypesForFilter(
  propertyCode: string,
  roomTypeParam: string,
): string[] {
  return resolveDbRoomTypesForBooking(propertyCode, roomTypeParam);
}

async function loadAvailabilityForStay(params: {
  propertyCode: string;
  roomType: string;
  checkInDate: string;
  checkOutDate: string;
  adults: number;
  children: number;
}) {
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

  const roomTypesFilter = resolveRoomTypesForFilter(prop.code, roomType);
  const unassignedPart = pendingUnassignedMatchAndClause(prop.id, roomTypesFilter);

  let roomsQ = supabase
    .from("rooms")
    .select("id, property_id, room_type, room_number, display_order")
    .eq("property_id", prop.id);
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

  const [rsRes, icRes] = await Promise.all([
    supabase
      .from("public_room_settings")
      .select("*")
      .eq("property_code", prop.code)
      .eq("room_type", roomType)
      .maybeSingle(),
    supabase
      .from("public_inventory_caps")
      .select("*")
      .eq("property_code", prop.code)
      .eq("room_type", roomType),
  ]);

  const dbRoomSetting = (rsRes.data as PublicRoomSettingRow | null) ?? null;
  const dbInventoryCaps = (icRes.data as PublicInventoryCapRow[] | null) ?? [];

  const hasDbPrice = dbRoomSetting !== null && dbRoomSetting.is_active === true;
  const hasCodePrice = !hasDbPrice && hasListPriceRule(prop.code, roomType);
  const listPriceForDate =
    hasDbPrice || hasCodePrice
      ? (dateYmd: string, gc: number) =>
          hasDbPrice
            ? listPriceFromRoomSetting(dbRoomSetting!, dateYmd, gc)
            : computeListPriceForNight(prop.code, roomType, dateYmd, gc)
      : undefined;

  const availabilityCap = resolvePublicAvailabilityCap(
    prop.code,
    roomType,
    roomTypesFilter,
    guestCount,
    dbInventoryCaps,
  );

  const body = computePublicAvailabilityByDate(
    checkInDate,
    nights,
    guestCount,
    rooms,
    reservations,
    {
      ...(listPriceForDate ? { listPriceForDate } : {}),
      ...(availabilityCap != null ? { availabilityCap } : {}),
    },
  );

  return { prop, nights, guestCount, availability: body };
}

export async function POST(req: NextRequest) {
  let payload: CreateCheckoutBody;
  try {
    payload = (await req.json()) as CreateCheckoutBody;
  } catch {
    return bad("Invalid JSON body");
  }

  const propertyCode = payload?.propertyCode;
  const roomType = payload?.roomType;
  const checkInDate = payload?.checkInDate;
  const checkOutDate = payload?.checkOutDate;
  const adults = payload?.adults;
  const children = payload?.children;
  const guestName = payload?.guestName;
  const guestEmail = payload?.guestEmail;
  const guestPhone = payload?.guestPhone;
  const successUrl = payload?.successUrl;
  const cancelUrl = payload?.cancelUrl;

  if (!propertyCode) return bad("propertyCode is required");
  if (!roomType) return bad("roomType is required");
  if (!checkInDate || !isValidYmd(checkInDate)) return bad("checkInDate is required");
  if (!checkOutDate || !isValidYmd(checkOutDate)) return bad("checkOutDate is required");

  const nights = differenceInCalendarDays(
    parseISO(`${checkOutDate}T00:00:00`),
    parseISO(`${checkInDate}T00:00:00`),
  );
  if (nights < 1) return bad("checkInDate must be before checkOutDate");

  const a = Number.isFinite(adults) ? Number(adults) : 2;
  const c = Number.isFinite(children) ? Number(children) : 0;
  const guestCount = a + c;
  if (guestCount < 1) return bad("adults + children must be >= 1");
  if (guestCount >= 5) return bad("guestCount must be <= 4");

  if (!guestName || typeof guestName !== "string" || !guestName.trim()) {
    return bad("guestName is required");
  }
  if (!guestEmail || typeof guestEmail !== "string" || !guestEmail.trim()) {
    return bad("guestEmail is required");
  }
  if (!successUrl || !cancelUrl) return bad("successUrl and cancelUrl are required");

  // Validate max guests by catalog rules (requested in spec).
  if (
    (propertyCode === "PG2" && roomType === "family" && guestCount > 4) ||
    (propertyCode === "PG3" && roomType === "family" && guestCount > 4)
  ) {
    return bad("guestCount exceeds max_guests");
  }

  let stay;
  try {
    // Re-check availability right before checkout creation.
    stay = await loadAvailabilityForStay({
      propertyCode,
      roomType,
      checkInDate,
      checkOutDate,
      adults: a,
      children: c,
    });
  } catch (e) {
    console.error("[public/create-checkout-session] availability", e);
    return bad("Availability check failed", 500);
  }

  const dates = stay.availability.dates;
  const allBookable = dates.every((d) => d.bookable && d.availableRooms > 0);
  const hasNullPrice = dates.some((d) => d.minPrice == null);
  if (!allBookable || hasNullPrice) {
    return bad("No availability", 409);
  }

  const totalAmount = dates.reduce((sum, d) => sum + (d.minPrice ?? 0), 0);
  if (!Number.isInteger(totalAmount) || totalAmount <= 0) {
    return bad("Invalid price", 409);
  }

  try {
    const session = await createStripeCheckoutSession({
      amountJpy: totalAmount,
      customerEmail: guestEmail,
      successUrl,
      cancelUrl,
      metadata: {
        propertyCode,
        roomType,
        checkInDate,
        checkOutDate,
        adults: String(a),
        children: String(c),
        guestName: guestName.trim().slice(0, 60),
        guestEmail: guestEmail.trim().slice(0, 120),
        guestPhone: (guestPhone ?? "").toString().slice(0, 30),
        totalAmount: String(totalAmount),
        source: "stripe_web",
      },
    });

    return NextResponse.json(
      { checkoutUrl: session.url, sessionId: session.id },
      { headers: corsJsonHeaders },
    );
  } catch (e) {
    console.error("[public/create-checkout-session] stripe", e);
    return bad("Failed to create checkout session", 500);
  }
}

