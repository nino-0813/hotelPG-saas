import { NextResponse, type NextRequest } from "next/server";
import { createServiceRoleSupabase } from "@/lib/supabase/service-role";
import { verifyStripeSignature } from "@/lib/stripe/stripe-signature";
import { addDays, differenceInCalendarDays, format, parseISO } from "date-fns";
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
  resolvePg3RoomTypesForFilter,
} from "@/lib/availability/public-rate-rules";
import type {
  PublicInventoryCapRow,
  PublicRoomSettingRow,
} from "@/lib/types/public-catalog";

export const runtime = "nodejs";

type StripeEvent = {
  id: string;
  type: string;
  data: {
    object: {
      id: string;
      metadata?: Record<string, string>;
      payment_status?: string;
    };
  };
};

type PropertyRow = { id: string; code: string };

function resolveRoomTypesForFilter(
  propertyCode: string,
  roomTypeParam: string,
): string[] {
  if (propertyCode === "PG3") {
    return resolvePg3RoomTypesForFilter(roomTypeParam);
  }
  return [roomTypeParam];
}

async function logWebhookEvent(params: {
  eventId: string;
  sessionId: string;
  level: "info" | "warn" | "error";
  message: string;
}) {
  try {
    const supabase = createServiceRoleSupabase();
    await supabase.from("webhook_event_logs").insert({
      source: "stripe",
      event_id: params.eventId,
      session_id: params.sessionId,
      level: params.level,
      message: params.message.slice(0, 500),
    });
  } catch (e) {
    console.error("[stripe/webhook] failed to write webhook_event_logs", e);
  }
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

  const { data: prop } = await supabase
    .from("properties")
    .select("id, code")
    .eq("code", propertyCode)
    .maybeSingle();
  if (!prop) throw new Error("Unknown propertyCode");

  const roomTypesFilter = resolveRoomTypesForFilter(prop.code, roomType);

  let roomsQ = supabase
    .from("rooms")
    .select("id, property_id, room_type, room_number, display_order")
    .eq("property_id", (prop as PropertyRow).id);
  roomsQ =
    roomTypesFilter.length === 1
      ? roomsQ.eq("room_type", roomTypesFilter[0])
      : roomsQ.in("room_type", roomTypesFilter);

  const { data: roomsRaw } = await roomsQ.returns<PublicRoomRow[]>();
  const rooms = roomsRaw ?? [];
  const roomIds = rooms.map((r) => r.id);

  const lastNight = format(
    addDays(parseISO(`${checkInDate}T12:00:00`), nights - 1),
    "yyyy-MM-dd",
  );

  const { data: reservationsRaw } = await supabase
    .from("reservations")
    .select(
      "room_id, requested_room_type, requested_property_id, check_in_date, check_out_date, status",
    )
    .in("status", ["confirmed", "checked_in", "blocked", "manual"])
    .lte("check_in_date", lastNight)
    .gt("check_out_date", checkInDate)
    .or(
      roomIds.length > 0
        ? [
            `room_id.in.(${roomIds.join(",")})`,
            `and(room_id.is.null,requested_property_id.eq.${(prop as PropertyRow).id},requested_room_type.eq.${roomType})`,
          ].join(",")
        : `and(room_id.is.null,requested_property_id.eq.${(prop as PropertyRow).id},requested_room_type.eq.${roomType})`,
    )
    .returns<PublicReservationRow[]>();
  const reservations = reservationsRaw ?? [];

  const [rsRes, icRes] = await Promise.all([
    supabase
      .from("public_room_settings")
      .select("*")
      .eq("property_code", (prop as PropertyRow).code)
      .eq("room_type", roomType)
      .maybeSingle(),
    supabase
      .from("public_inventory_caps")
      .select("*")
      .eq("property_code", (prop as PropertyRow).code)
      .eq("room_type", roomType),
  ]);

  const dbRoomSetting = (rsRes.data as PublicRoomSettingRow | null) ?? null;
  const dbInventoryCaps = (icRes.data as PublicInventoryCapRow[] | null) ?? [];

  const hasDbPrice = dbRoomSetting !== null && dbRoomSetting.is_active === true;
  const hasCodePrice = !hasDbPrice && hasListPriceRule((prop as PropertyRow).code, roomType);
  const listPriceForDate =
    hasDbPrice || hasCodePrice
      ? (dateYmd: string, gc: number) =>
          hasDbPrice
            ? listPriceFromRoomSetting(dbRoomSetting!, dateYmd, gc)
            : computeListPriceForNight((prop as PropertyRow).code, roomType, dateYmd, gc)
      : undefined;

  const availabilityCap = resolvePublicAvailabilityCap(
    (prop as PropertyRow).code,
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

  return { prop: prop as PropertyRow, nights, guestCount, availability: body };
}

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const sig = req.headers.get("stripe-signature");
  const v = verifyStripeSignature({
    rawBody,
    signatureHeader: sig,
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
  });
  if (!v.ok) {
    return new NextResponse(v.error, { status: 400 });
  }

  let event: StripeEvent;
  try {
    event = JSON.parse(rawBody) as StripeEvent;
  } catch {
    return new NextResponse("Invalid JSON", { status: 400 });
  }

  if (event.type !== "checkout.session.completed") {
    return new NextResponse("Ignored", { status: 200 });
  }

  const session = event.data.object;
  const sessionId = session.id;
  const md = session.metadata ?? {};

  const propertyCode = md.propertyCode;
  const roomType = md.roomType;
  const checkInDate = md.checkInDate;
  const checkOutDate = md.checkOutDate;
  const adults = Number.parseInt(md.adults ?? "0", 10);
  const children = Number.parseInt(md.children ?? "0", 10);
  const guestName = md.guestName ?? "";
  const guestEmail = md.guestEmail ?? "";
  const guestPhone = md.guestPhone ?? null;
  const totalAmount = Number.parseInt(md.totalAmount ?? "0", 10);

  if (!propertyCode || !roomType || !checkInDate || !checkOutDate) {
    await logWebhookEvent({
      eventId: event.id,
      sessionId,
      level: "error",
      message: "Missing required metadata fields",
    });
    return new NextResponse("Bad metadata", { status: 200 });
  }

  const supabase = createServiceRoleSupabase();

  // Idempotency: already saved.
  const { data: existing } = await supabase
    .from("reservations")
    .select("id")
    .eq("stripe_session_id", sessionId)
    .maybeSingle();
  if (existing?.id) {
    return new NextResponse("OK", { status: 200 });
  }

  // Re-check availability after payment (avoid overbooking).
  let stay;
  try {
    stay = await loadAvailabilityForStay({
      propertyCode,
      roomType,
      checkInDate,
      checkOutDate,
      adults: Number.isFinite(adults) ? adults : 0,
      children: Number.isFinite(children) ? children : 0,
    });
  } catch (e) {
    console.error("[stripe/webhook] availability check error", e);
    await logWebhookEvent({
      eventId: event.id,
      sessionId,
      level: "error",
      message: "Availability check failed during webhook",
    });
    return new NextResponse("OK", { status: 200 });
  }

  const dates = stay.availability.dates;
  const allBookable = dates.every((d) => d.bookable && d.availableRooms > 0);
  const hasNullPrice = dates.some((d) => d.minPrice == null);

  if (!allBookable || hasNullPrice) {
    await logWebhookEvent({
      eventId: event.id,
      sessionId,
      level: "warn",
      message: "No availability after payment; reservation not created",
    });
    return new NextResponse("OK", { status: 200 });
  }

  const requestedPropertyId = stay.prop.id;
  const guestCount = Math.max(1, (Number.isFinite(adults) ? adults : 0) + (Number.isFinite(children) ? children : 0));

  const specialNotes = `公式サイトStripe決済 / 金額: ${Number.isFinite(totalAmount) ? totalAmount : 0}円`;

  const { data: created, error: insErr } = await supabase
    .from("reservations")
    .insert({
      room_id: null,
      requested_property_id: requestedPropertyId,
      requested_room_type: roomType,
      guest_name: guestName.slice(0, 80) || "Web Guest",
      guest_email: guestEmail.slice(0, 200) || null,
      guest_phone: guestPhone ? String(guestPhone).slice(0, 40) : null,
      guest_count: guestCount,
      check_in_date: checkInDate,
      check_out_date: checkOutDate,
      check_in_time: "15:00:00",
      check_out_time: "11:00:00",
      payment_method: "online",
      source: "stripe_web",
      status: "confirmed",
      stripe_session_id: sessionId,
      special_notes: specialNotes.slice(0, 200),
    })
    .select("id")
    .single();

  if (insErr || !created?.id) {
    console.error("[stripe/webhook] insert reservation failed", insErr);
    await logWebhookEvent({
      eventId: event.id,
      sessionId,
      level: "error",
      message: "Insert to reservations failed",
    });
    return new NextResponse("OK", { status: 200 });
  }

  // Optional audit trail.
  try {
    await supabase.from("reservation_logs").insert({
      reservation_id: created.id,
      action: "created",
    });
  } catch (e) {
    console.error("[stripe/webhook] reservation_logs insert failed", e);
  }

  return new NextResponse("OK", { status: 200 });
}

