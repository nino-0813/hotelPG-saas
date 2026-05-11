import { addDays, format, parseISO } from "date-fns";
import { NextResponse, type NextRequest } from "next/server";
import {
  computePublicAvailabilityByDate,
  type PublicReservationRow,
  type PublicRoomRow,
} from "@/lib/availability/public-availability";
import { createServiceRoleSupabase } from "@/lib/supabase/service-role";

export const runtime = "nodejs";

const MAX_DAYS = 93;
const DEFAULT_DAYS = 31;

function isValidYmd(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = parseISO(`${s}T12:00:00`);
  return !Number.isNaN(d.getTime());
}

function parseStartDate(raw: string | null): string {
  if (raw && isValidYmd(raw)) return raw;
  return format(new Date(), "yyyy-MM-dd");
}

function parseDays(raw: string | null): number {
  if (raw === null || raw === "") return DEFAULT_DAYS;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) return DEFAULT_DAYS;
  return Math.min(n, MAX_DAYS);
}

function parseNonNegInt(raw: string | null, fallback: number): number {
  if (raw === null || raw === "") return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return n;
}

const corsJsonHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsJsonHeaders });
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const start = parseStartDate(searchParams.get("start"));
    const days = parseDays(searchParams.get("days"));
    const adults = parseNonNegInt(searchParams.get("adults"), 2);
    const children = parseNonNegInt(searchParams.get("children"), 0);
    const partySize = Math.max(1, adults + children);

    const lastDateStr = format(
      addDays(parseISO(`${start}T12:00:00`), days - 1),
      "yyyy-MM-dd",
    );

    const supabase = createServiceRoleSupabase();

    const { data: roomsRaw, error: roomsErr } = await supabase
      .from("rooms")
      .select("id, property_id, room_type, room_number, display_order")
      .returns<PublicRoomRow[]>();

    if (roomsErr) {
      console.error("[public/availability] rooms", roomsErr);
      return NextResponse.json(
        { error: "Failed to load rooms" },
        { status: 500, headers: corsJsonHeaders },
      );
    }

    const { data: reservationsRaw, error: resErr } = await supabase
      .from("reservations")
      .select(
        "room_id, requested_room_type, requested_property_id, check_in_date, check_out_date, status",
      )
      .in("status", ["confirmed", "checked_in"])
      .lte("check_in_date", lastDateStr)
      .gt("check_out_date", start)
      .returns<PublicReservationRow[]>();

    if (resErr) {
      console.error("[public/availability] reservations", resErr);
      return NextResponse.json(
        { error: "Failed to load reservations" },
        { status: 500, headers: corsJsonHeaders },
      );
    }

    const rooms = (roomsRaw ?? []) as PublicRoomRow[];
    const reservations = (reservationsRaw ?? []) as PublicReservationRow[];

    const body = computePublicAvailabilityByDate(
      start,
      days,
      partySize,
      rooms,
      reservations,
    );

    return NextResponse.json(body, {
      headers: {
        ...corsJsonHeaders,
        "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120",
      },
    });
  } catch (e) {
    console.error("[public/availability]", e);
    const message = e instanceof Error ? e.message : "Internal error";
    const isConfig = message.includes("Missing Supabase");
    return NextResponse.json(
      { error: isConfig ? "Service misconfigured" : "Internal error" },
      { status: isConfig ? 503 : 500, headers: corsJsonHeaders },
    );
  }
}
