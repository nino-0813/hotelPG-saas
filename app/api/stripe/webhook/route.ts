import { NextResponse, type NextRequest } from "next/server";
import { createServiceRoleSupabase } from "@/lib/supabase/service-role";
import { verifyStripeSignature } from "@/lib/stripe/stripe-signature";
import { loadPublicStayAvailability } from "@/lib/availability/load-public-stay-availability";
import { formatStripeWebReservationSpecialNotes } from "@/lib/stripe/stripe-web-checkout-pricing";
import { createReservationWithAssignment } from "@/lib/reservations/create-reservation-with-assignment";
import { insertStripeWebhookLog } from "@/lib/stripe/webhook-event-log";
import { sendMail } from "@/lib/gmail";
import { buildReservationConfirmedEmail } from "@/lib/mail/reservation-confirmed";
import {
  formatStripeWebReservationLineMessage,
  getLineChannelAccessToken,
  sendLineBroadcastText,
} from "@/lib/line";

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

  const targetNetFromMd = md.targetRoomNetAmount
    ? Number.parseInt(md.targetRoomNetAmount, 10)
    : Number.parseInt(md.totalAmount ?? "0", 10);
  const taxFromMd = Number.parseInt(md.accommodationTaxAmount ?? "0", 10);
  const chargeFromMd = Number.parseInt(
    md.stripeChargeAmount ?? md.totalAmount ?? "0",
    10,
  );
  const rawFromMd = md.rawStripeChargeAmount
    ? Number.parseInt(md.rawStripeChargeAmount, 10)
    : NaN;
  const roundingFromMd = md.roundingAmount
    ? Number.parseInt(md.roundingAmount, 10)
    : NaN;
  const roundingAmount =
    Number.isFinite(roundingFromMd) && !Number.isNaN(roundingFromMd)
      ? Math.max(0, roundingFromMd)
      : Number.isFinite(chargeFromMd) && Number.isFinite(rawFromMd)
        ? Math.max(0, chargeFromMd - rawFromMd)
        : 0;

  const supabase = createServiceRoleSupabase();

  if (!propertyCode || !roomType || !checkInDate || !checkOutDate) {
    await insertStripeWebhookLog(supabase, {
      event_type: "checkout.session.completed",
      event_id: event.id,
      stripe_session_id: sessionId,
      level: "error",
      message: "Missing required metadata fields",
      property_code: propertyCode ?? null,
      room_type: roomType ?? null,
      check_in_date: checkInDate ?? null,
      check_out_date: checkOutDate ?? null,
      reason: "bad_metadata",
      assigned_room_id: null,
      has_smart_key_code: null,
    });
    return new NextResponse("Bad metadata", { status: 200 });
  }

  const { data: existing } = await supabase
    .from("reservations")
    .select("id")
    .eq("stripe_session_id", sessionId)
    .maybeSingle();
  if (existing?.id) {
    return new NextResponse("OK", { status: 200 });
  }

  let stay;
  try {
    stay = await loadPublicStayAvailability({
      propertyCode,
      roomType,
      checkInDate,
      checkOutDate,
      adults: Number.isFinite(adults) ? adults : 0,
      children: Number.isFinite(children) ? children : 0,
    });
  } catch (e) {
    console.error("[stripe/webhook] availability check error", e);
    await insertStripeWebhookLog(supabase, {
      event_type: "checkout.session.completed",
      event_id: event.id,
      stripe_session_id: sessionId,
      level: "error",
      message: "Availability check failed during webhook",
      property_code: propertyCode,
      room_type: roomType,
      check_in_date: checkInDate,
      check_out_date: checkOutDate,
      reason: "availability_check_error",
      assigned_room_id: null,
      has_smart_key_code: null,
    });
    return new NextResponse("OK", { status: 200 });
  }

  const dates = stay.availability.dates;
  const allBookable = dates.every((d) => d.bookable && d.availableRooms > 0);
  const hasNullPrice = dates.some((d) => d.minPrice == null);

  if (!allBookable || hasNullPrice) {
    await insertStripeWebhookLog(supabase, {
      event_type: "checkout.session.completed",
      event_id: event.id,
      stripe_session_id: sessionId,
      level: "warn",
      message: "No availability after payment; reservation not created",
      property_code: propertyCode,
      room_type: roomType,
      check_in_date: checkInDate,
      check_out_date: checkOutDate,
      reason: "no_availability_after_payment",
      assigned_room_id: null,
      has_smart_key_code: null,
    });
    return new NextResponse("OK", { status: 200 });
  }

  const guestCount = Math.max(
    1,
    (Number.isFinite(adults) ? adults : 0) + (Number.isFinite(children) ? children : 0),
  );
  const hotelNetAmount = Number.isFinite(targetNetFromMd)
    ? Math.max(0, targetNetFromMd)
    : 0;
  const specialNotes = formatStripeWebReservationSpecialNotes({
    targetRoomNetAmount: hotelNetAmount,
    accommodationTaxAmount: Number.isFinite(taxFromMd) ? Math.max(0, taxFromMd) : 0,
    stripeChargeAmount: Number.isFinite(chargeFromMd) ? Math.max(0, chargeFromMd) : 0,
    roundingAmount,
  });

  const created = await createReservationWithAssignment({
    supabase,
    propertyCode,
    roomType,
    checkInDate,
    checkOutDate,
    guestName,
    guestEmail: guestEmail || null,
    guestPhone: guestPhone ? String(guestPhone) : null,
    guestCount,
    source: "stripe_web",
    paymentMethod: "online",
    stripeSessionId: sessionId,
    totalAmount: hotelNetAmount,
    specialNotes,
    stripeEventId: event.id,
  });

  if (!created.ok) {
    console.error("[stripe/webhook] createReservationWithAssignment", created.error);
    await insertStripeWebhookLog(supabase, {
      event_type: "checkout.session.completed",
      event_id: event.id,
      stripe_session_id: sessionId,
      level: "error",
      message: created.error.slice(0, 500),
      property_code: propertyCode,
      room_type: roomType,
      check_in_date: checkInDate,
      check_out_date: checkOutDate,
      reason: "reservation_insert_failed",
      assigned_room_id: null,
      has_smart_key_code: null,
    });
    return new NextResponse("OK", { status: 200 });
  }

  // ゲストへ予約確定メールを自動送信（手動送信と同一の文面）。
  // 失敗してもWebhookは200を返す（管理画面から手動再送できる）。
  try {
    const { data: r, error: rErr } = await supabase
      .from("reservations")
      .select(
        "guest_name, guest_email, guest_count, check_in_date, check_out_date, payment_method, requested_room_type, rooms(room_number, room_type, properties(code))",
      )
      .eq("id", created.reservationId)
      .single();

    if (rErr || !r) {
      console.error("[stripe/webhook] confirm-mail reload failed", rErr);
    } else {
      const built = buildReservationConfirmedEmail(r);
      if ("error" in built) {
        console.warn("[stripe/webhook] confirm-mail skipped:", built.error);
      } else {
        await sendMail(built.to, built.subject, built.body);
        await supabase
          .from("reservations")
          .update({ guest_mail_reservation_confirmed_sent_at: new Date().toISOString() })
          .eq("id", created.reservationId);
        await supabase.from("reservation_logs").insert({
          reservation_id: created.reservationId,
          action: "mail_reservation_confirmed_sent",
        });
      }
    }
  } catch (e) {
    console.error("[stripe/webhook] confirm-mail send exception", e);
  }

  const lineToken = getLineChannelAccessToken();
  if (lineToken) {
    const text = formatStripeWebReservationLineMessage({
      guestName: guestName,
      guestEmail: guestEmail,
      guestCount,
      propertyCode,
      roomType,
      checkInDate,
      checkOutDate,
      reservationId: created.reservationId,
    });
    try {
      const lineRes = await sendLineBroadcastText(text);
      const payload = {
        reservation_id: created.reservationId,
        stripe_session_id: sessionId,
        guest_name: guestName,
        check_in_date: checkInDate,
        check_out_date: checkOutDate,
      };
      if (lineRes.ok) {
        await supabase.from("notification_log").insert({
          type: "stripe_web_new_reservation",
          payload,
          sent_to_line_user_id: "broadcast",
          status: "sent",
          error: null,
          sent_at: new Date().toISOString(),
        });
      } else {
        console.error("[stripe/webhook] LINE notify failed", lineRes.error);
        await supabase.from("notification_log").insert({
          type: "stripe_web_new_reservation",
          payload: { ...payload, line_error: lineRes.error },
          sent_to_line_user_id: "broadcast",
          status: "failed",
          error: lineRes.error,
          sent_at: null,
        });
      }
    } catch (e) {
      console.error("[stripe/webhook] LINE notify exception", e);
    }
  }

  return new NextResponse("OK", { status: 200 });
}
