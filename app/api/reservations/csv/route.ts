import { NextRequest } from "next/server";
import { getCachedSupabaseAuth } from "@/lib/supabase/server";
import type { Property, Reservation, ReservationStatus, Room } from "@/lib/types/database";
import { reservationBreakfastFee, reservationRevenue, sourceLabel } from "@/lib/revenue";

const VALID_STATUSES = new Set<ReservationStatus>(["confirmed", "checked_in", "checked_out", "cancelled", "blocked"]);
const STATUS_LABELS: Record<ReservationStatus, string> = { confirmed: "未到着", checked_in: "滞在中", checked_out: "出発済み", cancelled: "キャンセル", blocked: "在庫停止" };

function csvCell(value: unknown) { return `"${String(value ?? "").replaceAll('"', '""')}"`; }

export async function GET(request: NextRequest) {
  const { supabase, user } = await getCachedSupabaseAuth();
  if (!user) return new Response("Unauthorized", { status: 401 });
  const { data: staff } = await supabase.from("staff").select("role").eq("id", user.id).maybeSingle();
  if (staff?.role !== "admin") return new Response("Forbidden", { status: 403 });

  const params = request.nextUrl.searchParams;
  const q = (params.get("q") ?? "").trim().toLocaleLowerCase("ja");
  const status = params.get("status") ?? "all";
  const property = params.get("property") ?? "all";
  const source = params.get("source") ?? "all";

  const [{ data: properties }, { data: rooms }] = await Promise.all([
    supabase.from("properties").select("*").returns<Property[]>(),
    supabase.from("rooms").select("*").returns<Room[]>(),
  ]);
  let query = supabase.from("reservations").select("*").order("check_in_date", { ascending: false }).limit(10000);
  if (VALID_STATUSES.has(status as ReservationStatus)) query = query.eq("status", status);
  if (source !== "all") query = source === "unknown" ? query.is("source", null) : query.eq("source", source);
  if (params.get("from")) query = query.gte("check_in_date", params.get("from")!);
  if (params.get("to")) query = query.lte("check_out_date", params.get("to")!);
  const { data } = await query.returns<Reservation[]>();

  const roomById = new Map((rooms ?? []).map((room) => [room.id, room]));
  const propertyById = new Map((properties ?? []).map((item) => [item.id, item]));
  const filtered = (data ?? []).filter((reservation) => {
    const room = reservation.room_id ? roomById.get(reservation.room_id) : undefined;
    const propertyId = room?.property_id ?? reservation.requested_property_id;
    if (property !== "all" && propertyId !== property) return false;
    if (!q) return true;
    return [reservation.guest_name, reservation.guest_phone, reservation.guest_email, reservation.smart_key_code, reservation.source, room?.room_number]
      .some((value) => value?.toLocaleLowerCase("ja").includes(q));
  });

  const header = ["予約ID", "チェックイン", "チェックアウト", "顧客名", "電話番号", "メール", "施設", "部屋", "人数", "予約経路", "決済方法", "ステータス", "朝食料金", "合計宿泊料金", "スマートキー"];
  const lines = filtered.map((reservation) => {
    const room = reservation.room_id ? roomById.get(reservation.room_id) : undefined;
    const hotel = propertyById.get(room?.property_id ?? reservation.requested_property_id ?? "");
    return [reservation.id, reservation.check_in_date, reservation.check_out_date, reservation.guest_name, reservation.guest_phone, reservation.guest_email, hotel?.name, room?.room_number, reservation.guest_count, sourceLabel(reservation.source), reservation.payment_method === "onsite" ? "現地決済" : "オンライン", STATUS_LABELS[reservation.status], reservationBreakfastFee(reservation), reservationRevenue(reservation), reservation.smart_key_code].map(csvCell).join(",");
  });
  const csv = `\uFEFF${header.map(csvCell).join(",")}\n${lines.join("\n")}`;
  return new Response(csv, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="hotelpg-reservations-${new Date().toISOString().slice(0, 10)}.csv"` } });
}
