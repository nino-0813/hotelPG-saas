import { addDays, format } from "date-fns";
import { redirect } from "next/navigation";
import { getCachedSupabaseAuth } from "@/lib/supabase/server";
import type { Property, Room } from "@/lib/types/database";
import {
  computeRakutenInventoryByDate,
  type RakutenInventoryReservationRow,
} from "@/lib/availability/rakuten-inventory";
import { RakutenInventoryGrid } from "./rakuten-inventory-grid";

type SearchParams = Promise<{ start?: string; days?: string }>;

export default async function RakutenInventoryPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const { supabase, user } = await getCachedSupabaseAuth();
  if (!user) redirect("/login");

  const { data: staffRow } = await supabase
    .from("staff")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  if (staffRow?.role !== "admin") redirect("/rooms");

  const { start, days: daysParam } = await searchParams;

  const startDate = start ? new Date(`${start}T00:00:00`) : new Date();
  startDate.setHours(0, 0, 0, 0);
  const days = Math.min(Math.max(Number(daysParam) || 14, 7), 31);
  const endDate = addDays(startDate, days);
  const startStr = format(startDate, "yyyy-MM-dd");
  const endStr = format(endDate, "yyyy-MM-dd");

  const [{ data: properties }, { data: rooms }, { data: reservations }] =
    await Promise.all([
      supabase
        .from("properties")
        .select("*")
        .order("display_order", { ascending: true })
        .returns<Property[]>(),
      supabase
        .from("rooms")
        .select("*")
        .order("display_order", { ascending: true })
        .returns<Room[]>(),
      // 出どころ問わず、期間に重なる有効予約（割当済み・未割当の両方）
      supabase
        .from("reservations")
        .select(
          "room_id, requested_property_id, requested_room_type, check_in_date, check_out_date, status",
        )
        .neq("status", "cancelled")
        .lt("check_in_date", endStr)
        .gte("check_out_date", startStr)
        .returns<RakutenInventoryReservationRow[]>(),
    ]);

  const inventory = computeRakutenInventoryByDate(
    startStr,
    days,
    (rooms ?? []).map((r) => ({
      id: r.id,
      property_id: r.property_id,
      room_type: r.room_type,
    })),
    reservations ?? [],
  );

  return (
    <main className="min-w-0 max-w-full px-4 py-4 sm:px-6 sm:py-6">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">楽天在庫</h1>
          <p className="mt-0.5 text-sm text-neutral-500">
            楽天に手動で入れる在庫数（= 物理部屋数 − 全予約）。SaaS が台帳、楽天は手入力。
          </p>
        </div>
        <DateRangeNav startDate={startDate} days={days} />
      </div>

      <div className="-mx-4 min-w-0 sm:mx-0">
        <RakutenInventoryGrid
          properties={properties ?? []}
          inventory={inventory}
        />
      </div>
    </main>
  );
}

function DateRangeNav({ startDate, days }: { startDate: Date; days: number }) {
  const prev = format(addDays(startDate, -days), "yyyy-MM-dd");
  const next = format(addDays(startDate, days), "yyyy-MM-dd");
  const today = format(new Date(), "yyyy-MM-dd");

  const linkClass =
    "rounded-md border border-neutral-300 bg-white px-2.5 py-1 text-xs hover:bg-neutral-50";

  return (
    <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:overflow-visible sm:px-0">
      <div className="flex items-center gap-2 whitespace-nowrap">
        <a className={linkClass} href={`?start=${prev}&days=${days}`}>
          ← 前
        </a>
        <a className={linkClass} href={`?start=${today}&days=${days}`}>
          今日
        </a>
        <a className={linkClass} href={`?start=${next}&days=${days}`}>
          次 →
        </a>
        <span className="ml-2 text-xs text-neutral-400">|</span>
        <a
          className={linkClass}
          href={`?start=${format(startDate, "yyyy-MM-dd")}&days=7`}
        >
          7日
        </a>
        <a
          className={linkClass}
          href={`?start=${format(startDate, "yyyy-MM-dd")}&days=14`}
        >
          14日
        </a>
        <a
          className={linkClass}
          href={`?start=${format(startDate, "yyyy-MM-dd")}&days=31`}
        >
          31日
        </a>
      </div>
    </div>
  );
}
