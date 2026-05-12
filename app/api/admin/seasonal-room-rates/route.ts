import { NextResponse, type NextRequest } from "next/server";
import { isAdminApiAuthorized } from "@/lib/admin/verify-admin-api-secret";
import { createServiceRoleSupabase } from "@/lib/supabase/service-role";
import type { PublicSeasonalRoomRateRow } from "@/lib/types/public-catalog";

export const runtime = "nodejs";

const adminCorsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, PUT, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, x-admin-api-secret",
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function adminJson(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: adminCorsHeaders });
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: adminCorsHeaders });
}

function requireAdmin(req: NextRequest): NextResponse | null {
  if (!process.env.ADMIN_API_SECRET) {
    return adminJson({ error: "ADMIN_API_SECRET is not configured" }, 503);
  }
  if (!isAdminApiAuthorized(req)) {
    return adminJson({ error: "Unauthorized" }, 401);
  }
  return null;
}

function isYmd(s: unknown): s is string {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

function isNonNegInt(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n) && n >= 0;
}

function isStr(n: unknown): n is string {
  return typeof n === "string" && n.length > 0;
}

export async function GET(req: NextRequest) {
  const deny = requireAdmin(req);
  if (deny) return deny;

  try {
    const supabase = createServiceRoleSupabase();
    const { searchParams } = new URL(req.url);
    const pc = searchParams.get("property_code");
    const rt = searchParams.get("room_type");

    let q = supabase
      .from("public_seasonal_room_rates")
      .select("*")
      .order("property_code")
      .order("room_type")
      .order("start_date");

    if (pc) q = q.eq("property_code", pc.trim());
    if (rt) q = q.eq("room_type", rt.trim());

    const { data, error } = await q.returns<PublicSeasonalRoomRateRow[]>();
    if (error) {
      console.error("[admin/seasonal-room-rates] GET", error);
      return adminJson({ error: "Failed to load seasonal rates" }, 500);
    }
    return adminJson({ seasonal_room_rates: data ?? [] });
  } catch (e) {
    console.error("[admin/seasonal-room-rates] GET", e);
    return adminJson({ error: "Internal error" }, 500);
  }
}

type SeasonalPatch = {
  id?: string;
  property_code: string;
  room_type: string;
  name: string;
  start_date: string;
  end_date: string;
  weekday_price: number;
  friday_price: number;
  saturday_price: number;
  included_guests?: number | null;
  extra_guest_fee?: number | null;
  inventory_cap_override?: number | null;
  is_active?: boolean;
  priority?: number;
};

export async function PUT(req: NextRequest) {
  const deny = requireAdmin(req);
  if (deny) return deny;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return adminJson({ error: "Invalid JSON body" }, 400);
  }

  const rows = (body as { seasonal_room_rates?: unknown }).seasonal_room_rates;
  if (!Array.isArray(rows) || rows.length === 0) {
    return adminJson({ error: "Provide seasonal_room_rates array" }, 400);
  }

  const supabase = createServiceRoleSupabase();

  for (const raw of rows) {
    if (!raw || typeof raw !== "object") {
      return adminJson({ error: "Invalid seasonal_room_rates entry" }, 400);
    }
    const p = raw as SeasonalPatch;

    if (!isStr(p.property_code) || !isStr(p.room_type) || !isStr(p.name)) {
      return adminJson(
        { error: "property_code, room_type, and name are required" },
        400,
      );
    }
    if (!isYmd(p.start_date) || !isYmd(p.end_date)) {
      return adminJson(
        { error: "start_date and end_date must be YYYY-MM-DD" },
        400,
      );
    }
    if (p.start_date > p.end_date) {
      return adminJson({ error: "start_date must be <= end_date" }, 400);
    }
    if (
      !isNonNegInt(p.weekday_price) ||
      !isNonNegInt(p.friday_price) ||
      !isNonNegInt(p.saturday_price)
    ) {
      return adminJson(
        {
          error:
            "weekday_price, friday_price, saturday_price must be non-negative integers",
        },
        400,
      );
    }

    const isActive = p.is_active !== undefined ? Boolean(p.is_active) : true;
    const priority =
      typeof p.priority === "number" && Number.isInteger(p.priority)
        ? p.priority
        : 100;

    if (p.included_guests !== undefined && p.included_guests !== null) {
      if (!isNonNegInt(p.included_guests) || p.included_guests < 1) {
        return adminJson(
          { error: "included_guests must be null or integer >= 1" },
          400,
        );
      }
    }
    if (p.extra_guest_fee !== undefined && p.extra_guest_fee !== null) {
      if (!isNonNegInt(p.extra_guest_fee)) {
        return adminJson(
          { error: "extra_guest_fee must be null or non-negative integer" },
          400,
        );
      }
    }
    if (
      p.inventory_cap_override !== undefined &&
      p.inventory_cap_override !== null
    ) {
      if (!isNonNegInt(p.inventory_cap_override)) {
        return adminJson(
          {
            error:
              "inventory_cap_override must be null or non-negative integer",
          },
          400,
        );
      }
    }

    const payload = {
      property_code: p.property_code.trim(),
      room_type: p.room_type.trim(),
      name: p.name.trim().slice(0, 200),
      start_date: p.start_date,
      end_date: p.end_date,
      weekday_price: p.weekday_price,
      friday_price: p.friday_price,
      saturday_price: p.saturday_price,
      included_guests: p.included_guests ?? null,
      extra_guest_fee: p.extra_guest_fee ?? null,
      inventory_cap_override: p.inventory_cap_override ?? null,
      is_active: isActive,
      priority,
    };

    if (p.id) {
      if (!UUID_RE.test(p.id)) {
        return adminJson({ error: "Invalid id" }, 400);
      }
      const { error } = await supabase
        .from("public_seasonal_room_rates")
        .update(payload)
        .eq("id", p.id);
      if (error) {
        console.error("[admin/seasonal-room-rates] PUT update", error);
        return adminJson({ error: error.message }, 500);
      }
    } else {
      const { error } = await supabase
        .from("public_seasonal_room_rates")
        .insert(payload);
      if (error) {
        console.error("[admin/seasonal-room-rates] PUT insert", error);
        return adminJson({ error: error.message }, 500);
      }
    }
  }

  const { data, error } = await supabase
    .from("public_seasonal_room_rates")
    .select("*")
    .order("property_code")
    .order("room_type")
    .order("start_date")
    .returns<PublicSeasonalRoomRateRow[]>();

  if (error) {
    return adminJson({ error: error.message }, 500);
  }

  return adminJson({ ok: true, seasonal_room_rates: data ?? [] });
}
