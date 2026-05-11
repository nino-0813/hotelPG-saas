import type { SupabaseClient } from "@supabase/supabase-js";
import type { RoomType } from "@/lib/types/database";
import {
  deriveSmartKeyCodeFallback,
  deriveSmartKeyCodeFromPhone,
} from "@/lib/reservations/guest-smart-key";
import { pickAvailableRoomForStay } from "@/lib/reservations/pick-available-room-for-stay";
import { resolveDbRoomTypesForBooking } from "@/lib/reservations/room-types-for-booking";
import { insertStripeWebhookLog } from "@/lib/stripe/webhook-event-log";

export type CreateReservationWithAssignmentInput = {
  supabase: SupabaseClient;
  propertyCode: string;
  /** Web / catalog room type (e.g. PG3 `family`). */
  roomType: string;
  checkInDate: string;
  checkOutDate: string;
  guestName: string;
  guestEmail: string | null;
  guestPhone: string | null;
  guestCount: number;
  source: string;
  paymentMethod: "online" | "onsite";
  stripeSessionId: string | null;
  /** Total charged (yen); used by callers for notes / analytics only. */
  totalAmount?: number;
  specialNotes: string;
  /** Stripe `evt_*` for webhook logs (optional). */
  stripeEventId?: string | null;
};

export type CreateReservationWithAssignmentResult =
  | { ok: true; reservationId: string; roomId: string | null }
  | { ok: false; error: string };

function resolveSmartKey(params: {
  roomMasterKey: string | null;
  guestPhone: string | null;
  stripeSessionId: string | null;
}): { code: string; source: "room_master" | "phone" | "session_fallback" } {
  const fromRoom = params.roomMasterKey?.trim();
  if (fromRoom && fromRoom.length > 0) {
    return { code: fromRoom.slice(0, 40), source: "room_master" };
  }
  const fromPhone = deriveSmartKeyCodeFromPhone(
    params.guestPhone ? String(params.guestPhone) : null,
  );
  if (fromPhone) {
    return { code: fromPhone, source: "phone" };
  }
  const seed = params.stripeSessionId ?? "stripe";
  return { code: deriveSmartKeyCodeFallback(seed), source: "session_fallback" };
}

/**
 * Inserts a reservation with Rakuten-style auto room assignment + smart key.
 * DB triggers on `reservations` create tasks when `room_id` is set on insert.
 */
export async function createReservationWithAssignment(
  input: CreateReservationWithAssignmentInput,
): Promise<CreateReservationWithAssignmentResult> {
  const {
    supabase,
    propertyCode,
    roomType,
    checkInDate,
    checkOutDate,
    guestName,
    guestEmail,
    guestPhone,
    guestCount,
    source,
    paymentMethod,
    stripeSessionId,
    specialNotes,
    stripeEventId,
  } = input;

  const { data: prop, error: propErr } = await supabase
    .from("properties")
    .select("id, code")
    .eq("code", propertyCode)
    .maybeSingle();

  if (propErr || !prop) {
    return { ok: false, error: "Unknown propertyCode" };
  }

  const dbRoomTypes = resolveDbRoomTypesForBooking(prop.code, roomType);
  const picked = await pickAvailableRoomForStay(supabase, {
    propertyId: prop.id,
    roomTypes: dbRoomTypes,
    checkInDate,
    checkOutDate,
    excludeReservationId: null,
  });

  const assignedRoomId = picked.roomId;
  const assignedRoomType = (
    assignedRoomId && picked.roomType ? picked.roomType : roomType
  ) as RoomType;

  const sk = resolveSmartKey({
    roomMasterKey: picked.roomSmartKey,
    guestPhone,
    stripeSessionId,
  });

  const { data: created, error: insErr } = await supabase
    .from("reservations")
    .insert({
      room_id: assignedRoomId,
      requested_property_id: prop.id,
      requested_room_type: assignedRoomType,
      guest_name: guestName.slice(0, 80) || "Guest",
      guest_email: guestEmail ? guestEmail.slice(0, 200) : null,
      guest_phone: guestPhone ? String(guestPhone).slice(0, 40) : null,
      guest_count: Math.max(1, guestCount),
      check_in_date: checkInDate,
      check_out_date: checkOutDate,
      check_in_time: "15:00",
      check_out_time: "11:00",
      payment_method: paymentMethod,
      source,
      status: "confirmed",
      stripe_session_id: stripeSessionId,
      smart_key_code: sk.code,
      special_notes: specialNotes.slice(0, 200),
    })
    .select("id")
    .single();

  if (insErr || !created?.id) {
    return { ok: false, error: insErr?.message ?? "insert failed" };
  }

  try {
    await supabase.from("reservation_logs").insert({
      reservation_id: created.id,
      action: "created",
    });
  } catch {
    // non-fatal
  }

  if (stripeSessionId && stripeEventId) {
    await insertStripeWebhookLog(supabase, {
      event_type: "checkout.session.completed",
      event_id: stripeEventId,
      stripe_session_id: stripeSessionId,
      level: !assignedRoomId ? "warn" : "info",
      message: !assignedRoomId
        ? "Reservation inserted without assigned room"
        : `Reservation inserted; key_source=${sk.source}`,
      property_code: propertyCode,
      room_type: roomType,
      check_in_date: checkInDate,
      check_out_date: checkOutDate,
      reason: !assignedRoomId
        ? "no_available_room_for_assignment"
        : sk.source === "session_fallback"
          ? "smart_key_session_fallback"
          : null,
      assigned_room_id: assignedRoomId,
      has_smart_key_code: sk.code.length > 0,
    });
  }

  return { ok: true, reservationId: created.id, roomId: assignedRoomId };
}
