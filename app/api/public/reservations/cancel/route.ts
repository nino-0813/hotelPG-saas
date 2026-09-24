import { NextRequest } from "next/server";
import {
  formatGuestCancellationLineMessage,
  getLineChannelAccessToken,
  sendLineBroadcastText,
} from "@/lib/line";
import { createServiceRoleSupabase } from "@/lib/supabase/service-role";

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null) as { token?: string } | null;
  const token = body?.token?.trim();
  if (!token || !/^[0-9a-f-]{36}$/i.test(token)) return Response.json({ error: "無効なURLです" }, { status: 400 });
  const db = createServiceRoleSupabase();
  const { data: reservation } = await db
    .from("reservations")
    .select("id,status,guest_name,guest_email,guest_count,check_in_date,check_out_date")
    .eq("guest_cancellation_token", token)
    .maybeSingle();
  if (!reservation) return Response.json({ error: "予約が見つかりません" }, { status: 404 });
  if (reservation.status === "cancelled") return Response.json({ ok: true, alreadyCancelled: true });
  if (reservation.status === "checked_in" || reservation.status === "checked_out") return Response.json({ error: "この予約はオンラインでキャンセルできません" }, { status: 409 });
  const { error } = await db.from("reservations").update({ status: "cancelled", guest_cancelled_at: new Date().toISOString() }).eq("id", reservation.id);
  if (error) return Response.json({ error: "キャンセル処理に失敗しました" }, { status: 500 });
  await db.from("reservation_logs").insert({ reservation_id: reservation.id, action: "cancelled" });

  if (getLineChannelAccessToken()) {
    const payload = {
      reservation_id: reservation.id,
      guest_name: reservation.guest_name,
      check_in_date: reservation.check_in_date,
      check_out_date: reservation.check_out_date,
    };
    try {
      const result = await sendLineBroadcastText(
        formatGuestCancellationLineMessage({
          guestName: reservation.guest_name,
          guestEmail: reservation.guest_email,
          guestCount: reservation.guest_count,
          checkInDate: reservation.check_in_date,
          checkOutDate: reservation.check_out_date,
          reservationId: reservation.id,
        }),
      );
      await db.from("notification_log").insert({
        type: "guest_reservation_cancelled",
        payload,
        sent_to_line_user_id: "broadcast",
        status: result.ok ? "sent" : "failed",
        error: result.ok ? null : result.error,
        sent_at: result.ok ? new Date().toISOString() : null,
      });
    } catch (notificationError) {
      console.error("[guest-cancel] LINE notify failed", notificationError);
    }
  }

  return Response.json({ ok: true });
}
