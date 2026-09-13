import { endOfDay, format, startOfDay } from "date-fns";
import { redirect } from "next/navigation";
import { getCachedSupabaseAuth } from "@/lib/supabase/server";
import type { Property, Room, Staff, Task } from "@/lib/types/database";
import { HousekeepingBoard } from "./housekeeping-board";

export type CleaningRow = Task & {
  room: Pick<Room, "room_number"> & { property: Pick<Property, "name"> };
  reservation: { guest_name: string; check_out_date: string; special_notes: string | null } | null;
  assignee: Pick<Staff, "display_name"> | null;
};

export default async function HousekeepingPage() {
  const { supabase, user } = await getCachedSupabaseAuth();
  if (!user) redirect("/login");
  const today = new Date();
  const [{ data: tasks }, { data: staff }] = await Promise.all([
    supabase.from("tasks").select(`*,room:rooms!inner(room_number,property:properties!inner(name)),reservation:reservations(guest_name,check_out_date,special_notes),assignee:staff(display_name)`).eq("type", "cleaning").gte("scheduled_for", startOfDay(today).toISOString()).lte("scheduled_for", endOfDay(today).toISOString()).order("scheduled_for").returns<CleaningRow[]>(),
    supabase.from("staff").select("*").order("display_name").returns<Staff[]>(),
  ]);
  return <HousekeepingBoard tasks={tasks ?? []} staff={staff ?? []} dateLabel={format(today, "yyyy/MM/dd")} />;
}
