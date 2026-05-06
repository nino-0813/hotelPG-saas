import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { RoomType } from "@/lib/types/database";

export const runtime = "nodejs";

const ALLOWED_ROOM_TYPES: RoomType[] = [
  "standard",
  "family",
  "single",
  "washitsu_modern_4",
  "washitsu_modern_3",
];

function toIcsDate(dateStr: string): string {
  // YYYY-MM-DD -> YYYYMMDD
  return dateStr.replaceAll("-", "");
}

function toDtStampUtc(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    d.getUTCFullYear() +
    pad(d.getUTCMonth() + 1) +
    pad(d.getUTCDate()) +
    "T" +
    pad(d.getUTCHours()) +
    pad(d.getUTCMinutes()) +
    pad(d.getUTCSeconds()) +
    "Z"
  );
}

function buildCalendar(
  events: Array<{ uid: string; dtstamp: string; dtstart: string; dtend: string }>,
) {
  const lines: string[] = [];
  lines.push("BEGIN:VCALENDAR");
  lines.push("VERSION:2.0");
  lines.push("PRODID:-//HotelPG SaaS//Rakuten Block Feed//JA");
  lines.push("CALSCALE:GREGORIAN");

  for (const e of events) {
    lines.push("BEGIN:VEVENT");
    lines.push(`UID:${e.uid}`);
    lines.push(`DTSTAMP:${e.dtstamp}`);
    lines.push("SUMMARY:Booked");
    lines.push(`DTSTART;VALUE=DATE:${e.dtstart}`);
    lines.push(`DTEND;VALUE=DATE:${e.dtend}`);
    lines.push("END:VEVENT");
  }

  lines.push("END:VCALENDAR");
  return lines.join("\r\n") + "\r\n";
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ propertyCode: string; roomType: string }> },
) {
  const { searchParams } = new URL(req.url);
  const token = searchParams.get("token");
  if (token !== process.env.ICAL_EXPORT_TOKEN) {
    return new Response("Unauthorized", { status: 401 });
  }

  try {
    const { propertyCode, roomType } = await params;
    const rt = roomType as RoomType;
    if (!ALLOWED_ROOM_TYPES.includes(rt)) {
      const ics = buildCalendar([]);
      return new NextResponse(ics, {
        headers: { "Content-Type": "text/calendar" },
      });
    }

    const supabase = await createClient();

    const { data: prop, error: propErr } = await supabase
      .from("properties")
      .select("id")
      .eq("code", propertyCode)
      .single();

    if (propErr || !prop) {
      const ics = buildCalendar([]);
      return new NextResponse(ics, {
        headers: { "Content-Type": "text/calendar" },
      });
    }

    const { data: rooms, error: roomsErr } = await supabase
      .from("rooms")
      .select("id")
      .eq("property_id", prop.id)
      .eq("room_type", rt);

    if (roomsErr) {
      console.error("rooms query failed", roomsErr.message);
      return new Response("Internal Server Error", { status: 500 });
    }

    const roomIds = (rooms ?? []).map((r) => r.id);
    const todayStr = new Date().toISOString().slice(0, 10);

    if (roomIds.length === 0) {
      const ics = buildCalendar([]);
      return new NextResponse(ics, {
        headers: { "Content-Type": "text/calendar" },
      });
    }

    const dtstamp = toDtStampUtc(new Date());

    const { data: reservations, error: resErr } = await supabase
      .from("reservations")
      .select("id, check_in_date, check_out_date, status, updated_at")
      .in("room_id", roomIds)
      .neq("status", "cancelled")
      .gte("check_out_date", todayStr)
      .order("updated_at", { ascending: false });

    if (resErr) {
      console.error("reservations query failed", resErr.message);
      return new Response("Internal Server Error", { status: 500 });
    }

    const events =
      reservations?.map((r) => ({
        uid: `reservation-${r.id}@hotelpg`,
        dtstamp,
        dtstart: toIcsDate(String(r.check_in_date)),
        dtend: toIcsDate(String(r.check_out_date)),
      })) ?? [];

    const ics = buildCalendar(events);
    return new NextResponse(ics, {
      headers: { "Content-Type": "text/calendar" },
    });
  } catch (e) {
    console.error("ical export failed", e);
    return new Response("Internal Server Error", { status: 500 });
  }
}

