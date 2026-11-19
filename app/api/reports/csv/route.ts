import { NextRequest } from "next/server";
import { getCachedSupabaseAuth } from "@/lib/supabase/server";
import { sourceLabel } from "@/lib/revenue";
import { paymentMethodLabel } from "@/lib/payment-methods";
import { dateOrdinal } from "@/lib/reservations/nightly-rates";
import { loadSalesReservations, reportPropertyId, salesInPeriod } from "@/lib/sales-report";

function csvCell(value: unknown) { return `"${String(value ?? "").replaceAll('"', '""')}"`; }

export async function GET(request: NextRequest) {
  const { supabase, user } = await getCachedSupabaseAuth();
  if (!user) return new Response("Unauthorized", { status: 401 });
  const { data: staff } = await supabase.from("staff").select("role").eq("id", user.id).maybeSingle();
  if (staff?.role !== "admin") return new Response("Forbidden", { status: 403 });

  const start = request.nextUrl.searchParams.get("start") ?? "2000-01-01";
  const end = request.nextUrl.searchParams.get("end") ?? "2999-12-31";
  if (!(dateOrdinal(start) <= dateOrdinal(end))) return new Response("Invalid date range", { status: 400 });

  const property = request.nextUrl.searchParams.get("property");
  const filterProperty = property && property !== "all";
  const [sales, rooms] = await Promise.all([
    loadSalesReservations(supabase, start, end),
    filterProperty ? supabase.from("rooms").select("id,property_id") : null,
  ]);
  if (sales.error || rooms?.error) return new Response("売上データを読み込めませんでした。", { status: 500 });

  const roomById = new Map((rooms?.data ?? []).map((room) => [room.id, room]));
  const header = ["予約ID", "顧客名", "チェックイン", "チェックアウト", "販売経路", "決済方法", "状態", "売上金額", "宿泊税", "消費税", "日別料金", "料金未設定泊数"];
  const lines = sales.reservations
    .filter((row) => !filterProperty || reportPropertyId(row, roomById) === property)
    .sort((a, b) => a.check_in_date.localeCompare(b.check_in_date))
    .map((row) => {
      const totals = salesInPeriod(row, start, end);
      const priceStatus = totals.estimated ? "仮配分" : totals.missing ? "未設定あり" : "設定済み";
      return [row.id, row.guest_name, row.check_in_date, row.check_out_date, sourceLabel(row.source), paymentMethodLabel(row.payment_method), row.status,
        totals.amount, totals.lodgingTax, totals.consumptionTax, priceStatus, totals.missing].map(csvCell).join(",");
    });
  const csv = `\uFEFF${header.map(csvCell).join(",")}\n${lines.join("\n")}`;
  return new Response(csv, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="hotelpg-sales-${start}-${end}.csv"` } });
}
