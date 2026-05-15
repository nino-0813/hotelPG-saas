import { NextResponse, type NextRequest } from "next/server";
import { isAdminApiAuthorized } from "@/lib/admin/verify-admin-api-secret";
import {
  formatStripeWebReservationLineMessage,
  sendLineBroadcastText,
} from "@/lib/line";
import { createServiceRoleSupabase } from "@/lib/supabase/service-role";

export const runtime = "nodejs";

const DEFAULT_TEST_MESSAGE =
  "【HOTEL PG】接続テスト\nこのメッセージは管理API（/api/admin/line-test）からの送信テストです。";

function requireAdmin(req: NextRequest): NextResponse | null {
  if (!process.env.ADMIN_API_SECRET) {
    return NextResponse.json(
      { ok: false, error: "ADMIN_API_SECRET is not configured" },
      { status: 503 },
    );
  }
  if (!isAdminApiAuthorized(req)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  return null;
}

type ReservationLineParts = {
  guestName: string;
  guestEmail: string;
  guestCount: number;
  propertyCode: string;
  roomType: string;
  checkInDate: string;
  checkOutDate: string;
  reservationId: string;
};

async function loadReservationLineParts(
  reservationId: string,
): Promise<ReservationLineParts | null> {
  const supabase = createServiceRoleSupabase();
  const { data: r, error } = await supabase
    .from("reservations")
    .select(
      "id, guest_name, guest_email, guest_count, check_in_date, check_out_date, requested_property_id, requested_room_type, room_id",
    )
    .eq("id", reservationId)
    .maybeSingle();

  if (error || !r) return null;

  let propertyCode = "—";
  let roomTypeStr = "—";

  if (r.requested_property_id) {
    const { data: p } = await supabase
      .from("properties")
      .select("code")
      .eq("id", r.requested_property_id)
      .maybeSingle();
    if (p?.code) propertyCode = p.code;
  }

  if (r.requested_room_type) {
    roomTypeStr = r.requested_room_type;
  }

  if (r.room_id) {
    const { data: room } = await supabase
      .from("rooms")
      .select("room_type, property_id")
      .eq("id", r.room_id)
      .maybeSingle();
    if (room?.room_type && roomTypeStr === "—") {
      roomTypeStr = room.room_type;
    }
    if (propertyCode === "—" && room?.property_id) {
      const { data: p } = await supabase
        .from("properties")
        .select("code")
        .eq("id", room.property_id)
        .maybeSingle();
      if (p?.code) propertyCode = p.code;
    }
  }

  return {
    reservationId: r.id,
    guestName: r.guest_name,
    guestEmail: r.guest_email ?? "",
    guestCount: r.guest_count,
    propertyCode,
    roomType: roomTypeStr,
    checkInDate: r.check_in_date,
    checkOutDate: r.check_out_date,
  };
}

/** GET: `?reservationId=uuid` で既存予約の文面を送る。なければ接続テスト文を送る。 */
export async function GET(req: NextRequest) {
  const deny = requireAdmin(req);
  if (deny) return deny;

  const reservationId = req.nextUrl.searchParams.get("reservationId")?.trim();
  let text = DEFAULT_TEST_MESSAGE;
  if (reservationId) {
    const parts = await loadReservationLineParts(reservationId);
    if (!parts) {
      return NextResponse.json(
        { ok: false, error: "Reservation not found" },
        { status: 404 },
      );
    }
    text = formatStripeWebReservationLineMessage(parts);
  }

  const result = await sendLineBroadcastText(text);
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 502 });
  }
  return NextResponse.json({
    ok: true,
    message: "LINE broadcast sent",
    mode: reservationId ? "reservation" : "ping",
  });
}

/** POST: `{ "reservationId": "uuid" }` で既存予約の文面。なければ `{ "message": "..." }` または接続テスト。 */
export async function POST(req: NextRequest) {
  const deny = requireAdmin(req);
  if (deny) return deny;

  let text = DEFAULT_TEST_MESSAGE;
  let mode: "reservation" | "custom" | "ping" = "ping";

  try {
    const body = (await req.json()) as {
      reservationId?: unknown;
      message?: unknown;
    };
    const rid =
      typeof body.reservationId === "string"
        ? body.reservationId.trim()
        : "";
    if (rid) {
      const parts = await loadReservationLineParts(rid);
      if (!parts) {
        return NextResponse.json(
          { ok: false, error: "Reservation not found" },
          { status: 404 },
        );
      }
      text = formatStripeWebReservationLineMessage(parts);
      mode = "reservation";
    } else if (typeof body.message === "string" && body.message.trim().length > 0) {
      text = body.message.trim().slice(0, 4500);
      mode = "custom";
    }
  } catch {
    // use default
  }

  const result = await sendLineBroadcastText(text);
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 502 });
  }
  return NextResponse.json({ ok: true, message: "LINE broadcast sent", mode });
}
