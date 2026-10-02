import { addDays, format, isValid, parseISO } from "date-fns";
import { redirect } from "next/navigation";
import { getCachedSupabaseAuth } from "@/lib/supabase/server";
import type { Property, Room, Staff, Task } from "@/lib/types/database";
import { HousekeepingBoard } from "./housekeeping-board";

export type CleaningRow = Task & {
  room: Pick<Room, "room_number"> & { property: Pick<Property, "name"> };
  reservation: { guest_name: string; check_in_date: string; check_out_date: string; special_notes: string | null } | null;
  assignee: Pick<Staff, "display_name"> | null;
};

type SearchParams = Promise<{ date?: string | string[] }>;

function resolveDate(value: string | string[] | undefined) {
  const raw = typeof value === "string" ? value : "";
  const parsed = parseISO(raw);
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw) && isValid(parsed) && format(parsed, "yyyy-MM-dd") === raw) return raw;
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo" }).format(new Date());
}

export default async function HousekeepingPage({ searchParams }: { searchParams: SearchParams }) {
  const { supabase, user } = await getCachedSupabaseAuth();
  if (!user) redirect("/login");
  const params = await searchParams;
  const selectedDate = resolveDate(params.date);
  const selected = parseISO(selectedDate);
  const nextDate = format(addDays(selected, 1), "yyyy-MM-dd");
  const rangeStart = new Date(`${selectedDate}T00:00:00+09:00`);
  const rangeEnd = new Date(`${nextDate}T00:00:00+09:00`);
  const [{ data: tasks }, { data: staff }] = await Promise.all([
    supabase.from("tasks").select(`*,room:rooms!inner(room_number,property:properties!inner(name)),reservation:reservations(guest_name,check_in_date,check_out_date,special_notes),assignee:staff(display_name)`).eq("type", "cleaning").gte("scheduled_for", rangeStart.toISOString()).lt("scheduled_for", rangeEnd.toISOString()).order("scheduled_for").returns<CleaningRow[]>(),
    supabase.from("staff").select("*").order("display_name").returns<Staff[]>(),
  ]);
  return <HousekeepingBoard tasks={tasks ?? []} staff={staff ?? []} selectedDate={selectedDate} dateLabel={format(selected, "yyyy/MM/dd")} />;
}
