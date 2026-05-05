import { addDays, format } from "date-fns";
import { createClient } from "@/lib/supabase/server";
import type { Property, Reservation, Room } from "@/lib/types/database";
import { ReservationCalendar } from "./reservation-calendar";

type SearchParams = Promise<{ start?: string; days?: string }>;

export default async function ReservationsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const { start, days: daysParam } = await searchParams;

  const startDate = start ? new Date(`${start}T00:00:00`) : new Date();
  startDate.setHours(0, 0, 0, 0);
  const days = Math.min(Math.max(Number(daysParam) || 14, 7), 31);
  const endDate = addDays(startDate, days);

  const supabase = await createClient();

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
      supabase
        .from("reservations")
        .select("*")
        .neq("status", "cancelled")
        .lt("check_in_date", format(endDate, "yyyy-MM-dd"))
        .gte("check_out_date", format(startDate, "yyyy-MM-dd"))
        .returns<Reservation[]>(),
    ]);

  return (
    <main className="px-4 py-4 sm:px-6 sm:py-6">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">予約一覧</h1>
          <p className="mt-0.5 text-sm text-neutral-500">
            {format(startDate, "yyyy/MM/dd")} 〜{" "}
            {format(addDays(startDate, days - 1), "yyyy/MM/dd")} ({days}日間)
          </p>
        </div>
        <DateRangeNav startDate={startDate} days={days} />
      </div>

      <div className="-mx-4 sm:mx-0">
        <ReservationCalendar
          properties={properties ?? []}
          rooms={rooms ?? []}
          reservations={reservations ?? []}
          startDate={startDate.toISOString()}
          days={days}
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
