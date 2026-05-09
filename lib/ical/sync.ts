import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchIcs, parseIcs, type ParsedReservation } from "./parse";

export type SyncResult = {
  calendarId: string;
  ok: boolean;
  imported: number;
  cancelled: number;
  error?: string;
};

function deriveSmartKeyCodeFromPhone(phone: string | null): string | null {
  if (!phone) return null;
  const normalized = phone
    .replace(/[０-９]/g, (ch) =>
      String.fromCharCode(ch.charCodeAt(0) - 0xff10 + 0x30),
    )
    .replace(/[‐‑‒–—―ー−]/g, "-");
  const digits = normalized.replace(/\D/g, "");
  if (digits.length < 4) return null;
  return digits.slice(-4);
}

function deriveSmartKeyCodeFallback(seed: string): string {
  // Stable 4-digit code derived from seed (reservation_code or external UID).
  // Intent: deterministic across re-sync; avoids 0000; slight "Porno/Innosima" flavor via multiplier.
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 39 + seed.charCodeAt(i)) % 100000; // 39 as a fixed factor
  }
  const n = (hash % 9000) + 1000; // 1000-9999
  return String(n).padStart(4, "0");
}

/**
 * Fetch one external calendar, upsert reservations matched by external_uid,
 * and mark missing UIDs as cancelled.
 *
 * Imported reservations have room_id = NULL (pending manual assignment).
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
      cancelled: 0,
      error: calErr?.message ?? "calendar not found",
    };
  }

  if (!cal.enabled) {
    return {
      calendarId,
      ok: false,
      imported: 0,
      cancelled: 0,
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
    return { calendarId, ok: false, imported: 0, cancelled: 0, error: msg };
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
  let firstUpsertError: string | null = null;

  const { data: roomsAll } = await supabase
    .from("rooms")
    .select("id, property_id, room_type, display_order")
    .eq("property_id", cal.property_id)
    .eq("room_type", cal.target_room_type)
    .order("display_order", { ascending: true });

  for (const ev of parsed) {
    const existingRow = existingMap.get(ev.uid);
    const existingReservationId = existingRow?.id ?? null;
    const pinnedRoomId = existingRow?.room_id ?? null;
    const smartKeyCode =
      deriveSmartKeyCodeFromPhone(ev.guest_phone) ??
      deriveSmartKeyCodeFallback(ev.reservation_code ?? ev.uid);

    let assignedRoomId: string | null = pinnedRoomId;
    if (!assignedRoomId) {
      const candidateRoomIds = (roomsAll ?? []).map((r) => r.id);
      let occupiedRoomIds = new Set<string>();
      if (candidateRoomIds.length > 0) {
        let q = supabase
          .from("reservations")
          .select("room_id")
          .neq("status", "cancelled")
          .in("room_id", candidateRoomIds)
          .lt("check_in_date", ev.check_out_date)
          .gt("check_out_date", ev.check_in_date);
        if (existingReservationId) q = q.neq("id", existingReservationId);
        const { data: overlaps } = await q.returns<{ room_id: string }[]>();
        occupiedRoomIds = new Set<string>((overlaps ?? []).map((r) => r.room_id));
      }

      const candidate = (roomsAll ?? []).find((r) => !occupiedRoomIds.has(r.id));
      assignedRoomId = candidate?.id ?? null;
    }

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
      last_sync_cancelled: cancelled,
    })
    .eq("id", calendarId);

  return {
    calendarId,
    ok: !upsertAllFailed,
    imported,
    cancelled,
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
