import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { RoomType } from "@/lib/types/database";

export const dynamic = "force-dynamic";

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

function toDtStamp(d: Date): string {
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

function icsEscapeText(s: string): string {
  return s.replaceAll("\\", "\\\\").replaceAll("\n", "\\n").replaceAll(",", "\\,");
}

export async function GET(
  request: Request,
  ctx: { params: Promise<{ propertyCode: string; roomType: string }> },
) {
  const token = new URL(request.url).searchParams.get("token");
  const expected = process.env.ICAL_EXPORT_TOKEN;
  if (!expected || token !== expected) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const { propertyCode, roomType } = await ctx.params;
  const rt = roomType as RoomType;
  if (!ALLOWED_ROOM_TYPES.includes(rt)) {
    return new NextResponse("Not found", { status: 404 });
  }

  const supabase = await createClient();

  const { data: prop, error: propErr } = await supabase
    .from("properties")
    .select("id, code, name")
    .eq("code", propertyCode)
    .single();

  if (propErr || !prop) {
    return new NextResponse("Not found", { status: 404 });
  }

  const { data: rooms, error: roomsErr } = await supabase
    .from("rooms")
    .select("id")
    .eq("property_id", prop.id)
    .eq("room_type", rt);

  if (roomsErr) {
    return new NextResponse("Rooms query failed", { status: 500 });
  }

  const roomIds = (rooms ?? []).map((r) => r.id);
  if (roomIds.length === 0) {
    const empty = buildCalendar({
      name: `${prop.name} / ${rt}`,
      events: [],
    });
    return new NextResponse(empty, {
      headers: {
        "content-type": "text/calendar; charset=utf-8",
        "cache-control": "no-store",
      },
    });
  }

  const todayStr = new Date().toISOString().slice(0, 10);

  const { data: reservations, error: resErr } = await supabase
    .from("reservations")
    .select("id, check_in_date, check_out_date, status")
    .in("room_id", roomIds)
    .neq("status", "cancelled")
    .gte("check_out_date", todayStr)
    .order("check_in_date", { ascending: true });

  if (resErr) {
    return new NextResponse("Reservations query failed", { status: 500 });
  }

  const now = new Date();
  const dtstamp = toDtStamp(now);
  const events =
    reservations?.map((r) => ({
      uid: `hotelpg-${r.id}`,
      dtstamp,
      dtstart: toIcsDate(r.check_in_date),
      dtend: toIcsDate(r.check_out_date),
      summary: "Booked",
      description: `source=hotelpg; status=${r.status}`,
    })) ?? [];

  const ics = buildCalendar({
    name: `${prop.name} / ${rt}`,
    events,
  });

  return new NextResponse(ics, {
    headers: {
      "content-type": "text/calendar; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function buildCalendar({
  name,
  events,
}: {
  name: string;
  events: Array<{
    uid: string;
    dtstamp: string;
    dtstart: string;
    dtend: string;
    summary: string;
    description?: string;
  }>;
}) {
  const lines: string[] = [];
  lines.push("BEGIN:VCALENDAR");
  lines.push("VERSION:2.0");
  lines.push("PRODID:-//HotelPG SaaS//Rakuten Block Feed//JA");
  lines.push("CALSCALE:GREGORIAN");
  lines.push(`X-WR-CALNAME:${icsEscapeText(name)}`);

  for (const e of events) {
    lines.push("BEGIN:VEVENT");
    lines.push(`UID:${icsEscapeText(e.uid)}`);
    lines.push(`DTSTAMP:${e.dtstamp}`);
    lines.push(`DTSTART;VALUE=DATE:${e.dtstart}`);
    lines.push(`DTEND;VALUE=DATE:${e.dtend}`);
    lines.push(`SUMMARY:${icsEscapeText(e.summary)}`);
    if (e.description) lines.push(`DESCRIPTION:${icsEscapeText(e.description)}`);
    lines.push("END:VEVENT");
  }

  lines.push("END:VCALENDAR");
  // CRLF required by many calendar consumers
  return lines.join("\r\n") + "\r\n";
}

