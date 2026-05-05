import { addDays, format } from "date-fns";
import { createClient } from "@/lib/supabase/server";
import type {
  Property,
  Reservation,
  Room,
  RoomStatusRow,
  Task,
} from "@/lib/types/database";
import { RoomStatusBoard } from "./room-status-board";

export default async function RoomsPage() {
  const supabase = await createClient();
  const today = format(new Date(), "yyyy-MM-dd");
  const weekLater = format(addDays(new Date(), 7), "yyyy-MM-dd");

  const [
    { data: properties },
    { data: rooms },
    { data: statuses },
    { data: currentReservations },
    { data: upcomingReservations },
    { data: openTasks },
  ] = await Promise.all([
    supabase
      .from("properties")
      .select("*")
      .order("display_order")
      .returns<Property[]>(),
    supabase
      .from("rooms")
      .select("*")
      .order("display_order")
      .returns<Room[]>(),
    supabase.from("room_status").select("*").returns<RoomStatusRow[]>(),
    supabase
      .from("reservations")
      .select("*")
      .lte("check_in_date", today)
      .gte("check_out_date", today)
      .neq("status", "cancelled")
      .returns<Reservation[]>(),
    supabase
      .from("reservations")
      .select("*")
      .gt("check_in_date", today)
      .lte("check_in_date", weekLater)
      .neq("status", "cancelled")
      .order("check_in_date")
      .returns<Reservation[]>(),
    supabase
      .from("tasks")
      .select("*")
      .in("status", ["todo", "in_progress"])
      .returns<Task[]>(),
  ]);

  return (
    <main className="px-4 py-4 sm:px-6 sm:py-6">
      <div className="mb-4">
        <h1 className="text-xl font-semibold tracking-tight">部屋ステータス</h1>
        <p className="mt-0.5 text-sm text-neutral-500">
          現在の各部屋の状態と滞在中・到着予定のゲスト
        </p>
      </div>

      <RoomStatusBoard
        properties={properties ?? []}
        rooms={rooms ?? []}
        statuses={statuses ?? []}
        currentReservations={currentReservations ?? []}
        upcomingReservations={upcomingReservations ?? []}
        openTasks={openTasks ?? []}
      />
    </main>
  );
}
