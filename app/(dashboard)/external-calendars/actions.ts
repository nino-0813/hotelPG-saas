"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { RoomType } from "@/lib/types/database";

export type AddCalendarInput = {
  source: string;
  ics_url: string;
  property_id: string;
  target_room_type: RoomType;
  display_name?: string;
};

/**
 * Best-effort extraction of an external_id from the ics URL.
 * Rakuten Oyado URLs look like /ical/v1/room_groups/917598.ics?s=...
 * Falls back to the URL pathname when no known pattern matches.
 */
function deriveExternalId(icsUrl: string): string {
  try {
    const u = new URL(icsUrl);
    const m = /\/room_groups\/(\d+)/.exec(u.pathname);
    if (m) return m[1];
    // generic fallback: pathname (without leading slash)
    return u.pathname.replace(/^\//, "") || icsUrl;
  } catch {
    return icsUrl;
  }
}

export async function addCalendar(input: AddCalendarInput) {
  const supabase = await createClient();
  const ics_url = input.ics_url.trim();
  const external_id = deriveExternalId(ics_url);
  const displayName = input.display_name?.trim();

  // Rakuten can reissue an iCal URL while keeping the same room-group ID.
  // In that case refresh the existing calendar instead of failing the unique
  // (source, external_id) constraint. Omitting a blank display name preserves
  // the existing label when an URL is refreshed.
  const calendar = {
    source: input.source,
    external_id,
    ics_url,
    property_id: input.property_id,
    target_room_type: input.target_room_type,
    ...(displayName ? { display_name: displayName } : {}),
    enabled: true,
    last_sync_status: null,
    last_sync_error: null,
  };
  const { error } = await supabase
    .from("external_calendars")
    .upsert(calendar, { onConflict: "source,external_id" });
  if (error) {
    return {
      error:
        error.code === "23505"
          ? "同じ外部カレンダーが登録済みです。既存の連携を確認してください。"
          : error.message,
    };
  }

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

export async function updateCalendarUrl(id: string, value: string) {
  const supabase = await createClient();
  const ics_url = value.trim();
  let external_id: string;
  try {
    const parsed = new URL(ics_url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return { error: "httpまたはhttpsのURLを入力してください" };
    }
    external_id = deriveExternalId(ics_url);
  } catch {
    return { error: "URLの形式を確認してください" };
  }

  const { error } = await supabase
    .from("external_calendars")
    .update({
      ics_url,
      external_id,
      enabled: true,
      last_sync_status: null,
      last_sync_error: null,
    })
    .eq("id", id);
  if (error) {
    return {
      error:
        error.code === "23505"
          ? "このURLは別の外部連携に登録済みです"
          : error.message,
    };
  }

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
  const { syncOneCalendar } = await import("@/lib/ical/sync");
  const supabase = await createClient();
  const result = await syncOneCalendar(supabase, id);
  revalidatePath("/external-calendars");
  revalidatePath("/reservations");
  return result;
}

export async function syncAll() {
  const { syncAllEnabledCalendars } = await import("@/lib/ical/sync");
  const supabase = await createClient();
  const results = await syncAllEnabledCalendars(supabase);
  revalidatePath("/external-calendars");
  revalidatePath("/reservations");
  return results;
}
