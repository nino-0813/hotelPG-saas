import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchIcs, parseIcs, type ParsedReservation } from "./parse";
import {
  deriveSmartKeyCodeFallback,
  deriveSmartKeyCodeFromPhone,
} from "@/lib/reservations/guest-smart-key";
import { pickAvailableRoomForStay } from "@/lib/reservations/pick-available-room-for-stay";

export type SyncNewBookingSummary = {
  guest_name: string;
  check_in_date: string;
  check_out_date: string;
};

export type SyncResult = {
  calendarId: string;
  ok: boolean;
  /** 新規+更新の合計（従来の取り込み件数） */
  imported: number;
  created: number;
  updated: number;
  cancelled: number;
  /** 今回新規に追加された予約（表示用、最大15件） */
  newBookings: SyncNewBookingSummary[];
  error?: string;
};

const MAX_NEW_BOOKING_PREVIEWS = 15;

/**
 * Fetch one external calendar, upsert reservations matched by external_uid,
 * and mark missing UIDs as cancelled.
 *
 * Imported reservations auto-assign a room when a free room exists in the calendar's room type.
 */
export async function syncOneCalendar(
  supabase: SupabaseClient,
  calendarId: string,
): Promise<SyncResult> {
  const { data: cal, error: calErr } = await supabase
    .from("external_calendars")
    .select("*")
    .eq("id", calendarId)
    .single();

  if (calErr || !cal) {
    return {
      calendarId,
      ok: false,
      imported: 0,
      created: 0,
      updated: 0,
      cancelled: 0,
      newBookings: [],
      error: calErr?.message ?? "calendar not found",
    };
  }

  if (!cal.enabled) {
    return {
      calendarId,
      ok: false,
      imported: 0,
      created: 0,
      updated: 0,
      cancelled: 0,
      newBookings: [],
      error: "calendar is disabled",
    };
  }

  let parsed: ParsedReservation[];
  try {
    const icsText = await fetchIcs(cal.ics_url);
    parsed = parseIcs(icsText);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await supabase
      .from("external_calendars")
      .update({
        last_synced_at: new Date().toISOString(),
        last_sync_status: "error",
        last_sync_error: msg.slice(0, 500),
      })
      .eq("id", calendarId);
    return {
      calendarId,
      ok: false,
      imported: 0,
      created: 0,
      updated: 0,
      cancelled: 0,
      newBookings: [],
      error: msg,
    };
  }

  // Existing reservations imported from this calendar (so we can detect deletions)
  const { data: existing } = await supabase
    .from("reservations")
    .select("id, external_uid, status, room_id")
    .eq("external_calendar_id", calendarId);

  const existingMap = new Map(
    (existing ?? [])
      .filter(
        (r): r is { id: string; external_uid: string; status: string; room_id: string | null } =>
          Boolean(r.external_uid),
      )
      .map((r) => [r.external_uid, r]),
  );

  const incomingUids = new Set(parsed.map((p) => p.uid));
  let imported = 0;
  let created = 0;
  let updated = 0;
  const newBookings: SyncNewBookingSummary[] = [];
  let firstUpsertError: string | null = null;

  for (const ev of parsed) {
    const existingRow = existingMap.get(ev.uid);
    const existingReservationId = existingRow?.id ?? null;
    const pinnedRoomId = existingRow?.room_id ?? null;

    let assignedRoomId: string | null = pinnedRoomId;
    let pickedRoomKey: string | null = null;
    if (!assignedRoomId) {
      const picked = await pickAvailableRoomForStay(supabase, {
        propertyId: cal.property_id,
        roomTypes: [cal.target_room_type],
        checkInDate: ev.check_in_date,
        checkOutDate: ev.check_out_date,
        excludeReservationId: existingReservationId,
      });
      assignedRoomId = picked.roomId;
      pickedRoomKey = picked.roomSmartKey;
    }

    const smartKeyCode =
      (pickedRoomKey && pickedRoomKey.trim().length > 0
        ? pickedRoomKey.trim().slice(0, 40)
        : null) ??
      deriveSmartKeyCodeFromPhone(ev.guest_phone) ??
      deriveSmartKeyCodeFallback(ev.reservation_code ?? ev.uid);

    const noteParts = [
      ev.reservation_code ? `予約コード: ${ev.reservation_code}` : null,
      ev.property_label ? `プラン: ${ev.property_label}` : null,
      ev.price ? `料金: ¥${ev.price.toLocaleString("ja-JP")}` : null,
      ev.source_url ? `元URL: ${ev.source_url}` : null,
      ev.children > 0 ? `子供: ${ev.children}名` : null,
      ev.infants > 0 ? `乳幼児: ${ev.infants}名` : null,
    ]
      .filter(Boolean)
      .join("\n");

    const payload = {
      // room_id: keep existing assignment, otherwise auto-assign if available
      room_id: assignedRoomId,
      external_uid: ev.uid,
      external_source: cal.source,
      external_calendar_id: cal.id,
      requested_property_id: cal.property_id,
      requested_room_type: cal.target_room_type,
      guest_name: ev.guest_name,
      guest_phone: ev.guest_phone,
      guest_email: ev.guest_email,
      guest_count: ev.guest_count,
      check_in_date: ev.check_in_date,
      check_out_date: ev.check_out_date,
      check_in_time: "15:00",
      check_out_time: "11:00",
      payment_method: "online" as const,
      smart_key_code: smartKeyCode,
      special_notes: noteParts || null,
      source: cal.source,
      status: "confirmed" as const,
    };

    const { error: upsertErr } = await supabase
      .from("reservations")
      .upsert(payload, { onConflict: "external_uid" });

    if (upsertErr) {
      if (!firstUpsertError) firstUpsertError = upsertErr.message;
      console.error("upsert failed", ev.uid, upsertErr.message);
      continue;
    }
    imported++;
    if (existingRow) {
      updated++;
    } else {
      created++;
      if (newBookings.length < MAX_NEW_BOOKING_PREVIEWS) {
        newBookings.push({
          guest_name: ev.guest_name,
          check_in_date: ev.check_in_date,
          check_out_date: ev.check_out_date,
        });
      }
    }
  }

  // Mark missing reservations as cancelled
  const missingUids: string[] = [];
  for (const [uid, row] of existingMap) {
    if (!incomingUids.has(uid) && row.status !== "cancelled") {
      missingUids.push(uid);
    }
  }

  let cancelled = 0;
  if (missingUids.length > 0) {
    const { error: cancelErr, count } = await supabase
      .from("reservations")
      .update({ status: "cancelled" }, { count: "exact" })
      .in("external_uid", missingUids);
    if (!cancelErr) cancelled = count ?? missingUids.length;
  }

  const upsertAllFailed =
    parsed.length > 0 && imported === 0 && firstUpsertError !== null;

  await supabase
    .from("external_calendars")
    .update({
      last_synced_at: new Date().toISOString(),
      last_sync_status: upsertAllFailed ? "error" : "success",
      last_sync_error:
        upsertAllFailed && firstUpsertError
          ? firstUpsertError.slice(0, 500)
          : null,
      last_sync_imported: imported,
      last_sync_created: created,
      last_sync_updated: updated,
      last_sync_cancelled: cancelled,
    })
    .eq("id", calendarId);

  return {
    calendarId,
    ok: !upsertAllFailed,
    imported,
    created,
    updated,
    cancelled,
    newBookings,
    ...(upsertAllFailed && firstUpsertError
      ? { error: firstUpsertError }
      : {}),
  };
}

export async function syncAllEnabledCalendars(
  supabase: SupabaseClient,
): Promise<SyncResult[]> {
  const { data: calendars } = await supabase
    .from("external_calendars")
    .select("id")
    .eq("enabled", true);

  const results: SyncResult[] = [];
  for (const c of calendars ?? []) {
    results.push(await syncOneCalendar(supabase, c.id));
  }
  return results;
}
