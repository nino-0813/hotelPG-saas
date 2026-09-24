import { NextRequest } from "next/server";
import { createServiceRoleSupabase } from "@/lib/supabase/service-role";

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null) as { token?: string } | null;
  const token = body?.token?.trim();
  if (!token || !/^[0-9a-f-]{36}$/i.test(token)) return Response.json({ error: "無効なURLです" }, { status: 400 });
  const db = createServiceRoleSupabase();
  const { data: reservation } = await db.from("reservations").select("id,status,check_in_date").eq("guest_cancellation_token", token).maybeSingle();
  if (!reservation) return Response.json({ error: "予約が見つかりません" }, { status: 404 });
  if (reservation.status === "cancelled") return Response.json({ ok: true, alreadyCancelled: true });
  if (reservation.status === "checked_in" || reservation.status === "checked_out") return Response.json({ error: "この予約はオンラインでキャンセルできません" }, { status: 409 });
  const { error } = await db.from("reservations").update({ status: "cancelled", guest_cancelled_at: new Date().toISOString() }).eq("id", reservation.id);
  if (error) return Response.json({ error: "キャンセル処理に失敗しました" }, { status: 500 });
  await db.from("reservation_logs").insert({ reservation_id: reservation.id, action: "cancelled" });
  return Response.json({ ok: true });
}
