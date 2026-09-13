import { NextRequest } from "next/server";
import { getCachedSupabaseAuth } from "@/lib/supabase/server";
import type { Reservation } from "@/lib/types/database";
import { reservationRevenue, reservationTax, sourceLabel } from "@/lib/revenue";

function csvCell(value: unknown) { return `"${String(value ?? "").replaceAll('"', '""')}"`; }

export async function GET(request: NextRequest) {
  const { supabase, user } = await getCachedSupabaseAuth();
  if (!user) return new Response("Unauthorized", { status: 401 });
  const start = request.nextUrl.searchParams.get("start") ?? "2000-01-01";
  const end = request.nextUrl.searchParams.get("end") ?? "2999-12-31";
  const { data } = await supabase.from("reservations").select("id,guest_name,check_in_date,check_out_date,source,payment_method,special_notes,status").gte("check_in_date", start).lte("check_in_date", end).neq("status", "blocked").order("check_in_date").returns<Reservation[]>();
  const header = ["予約ID","顧客名","チェックイン","チェックアウト","販売経路","決済方法","状態","売上金額","宿泊税","消費税"];
  const lines = (data ?? []).map((r) => { const tax = reservationTax(r); return [r.id,r.guest_name,r.check_in_date,r.check_out_date,sourceLabel(r.source),r.payment_method,r.status,reservationRevenue(r),tax.lodging,tax.consumption].map(csvCell).join(","); });
  const csv = `\uFEFF${header.map(csvCell).join(",")}\n${lines.join("\n")}`;
  return new Response(csv, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="hotelpg-sales-${start}-${end}.csv"` } });
}
