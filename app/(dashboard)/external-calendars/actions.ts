"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { syncAllEnabledCalendars, syncOneCalendar } from "@/lib/ical/sync";
import type { RoomType } from "@/lib/types/database";

export type AddCalendarInput = {
  source: string;
  external_id: string;
  ics_url: string;
  property_id: string;
  target_room_type: RoomType;
  display_name?: string;
};

export async function addCalendar(input: AddCalendarInput) {
  const supabase = await createClient();
  const { error } = await supabase.from("external_calendars").insert({
    source: input.source,
    external_id: input.external_id.trim(),
    ics_url: input.ics_url.trim(),
    property_id: input.property_id,
    target_room_type: input.target_room_type,
    display_name: input.display_name?.trim() || null,
    enabled: true,
  });
  if (error) return { error: error.message };

  revalidatePath("/external-calendars");
  return { ok: true };
}

export async function toggleCalendarEnabled(id: string, enabled: boolean) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("external_calendars")
    .update({ enabled })
    .eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/external-calendars");
  return { ok: true };
}

export async function deleteCalendar(id: string) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("external_calendars")
    .delete()
    .eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/external-calendars");
  return { ok: true };
}

export async function syncCalendar(id: string) {
  const supabase = await createClient();
  const result = await syncOneCalendar(supabase, id);
  revalidatePath("/external-calendars");
  revalidatePath("/reservations");
  return result;
}

export async function syncAll() {
  const supabase = await createClient();
  const results = await syncAllEnabledCalendars(supabase);
  revalidatePath("/external-calendars");
  revalidatePath("/reservations");
  return results;
}
