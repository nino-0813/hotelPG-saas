import { NextResponse, type NextRequest } from "next/server";
import { isAdminApiAuthorized } from "@/lib/admin/verify-admin-api-secret";
import { createServiceRoleSupabase } from "@/lib/supabase/service-role";
import type { PublicRoomSettingRow } from "@/lib/types/public-catalog";

export const runtime = "nodejs";

const adminCorsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, PUT, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, x-admin-api-secret",
};

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

export async function GET(req: NextRequest) {
  const deny = requireAdmin(req);
  if (deny) return deny;

  try {
    const supabase = createServiceRoleSupabase();
    const { data: room_settings, error: rsErr } = await supabase
      .from("public_room_settings")
      .select("*")
      .order("property_code")
      .order("room_type")
      .returns<PublicRoomSettingRow[]>();

    if (rsErr) {
      console.error("[admin/public-room-settings] GET", rsErr);
      return adminJson({ error: "Failed to load settings" }, 500);
    }

    return adminJson({
      room_settings: room_settings ?? [],
    });
  } catch (e) {
    console.error("[admin/public-room-settings] GET", e);
    return adminJson({ error: "Internal error" }, 500);
  }
}

type PutRoomSettingPatch = {
  property_code: string;
  room_type: string;
  weekday_price?: number;
  friday_price?: number;
  saturday_price?: number;
  included_guests?: number;
  extra_guest_fee?: number;
  max_guests?: number;
  inventory_cap?: number;
  is_active?: boolean;
  display_name?: string;
};

function isNonNegInt(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n) && n >= 0;
}

function isBool(n: unknown): n is boolean {
  return typeof n === "boolean";
}

function isStr(n: unknown): n is string {
  return typeof n === "string" && n.length > 0;
}

export async function PUT(req: NextRequest) {
  const deny = requireAdmin(req);
  if (deny) return deny;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return adminJson({ error: "Invalid JSON body" }, 400);
  }

  if (!body || typeof body !== "object") {
    return adminJson({ error: "Expected JSON object" }, 400);
  }

  const roomPatches = (body as { room_settings?: unknown }).room_settings;

  if (!Array.isArray(roomPatches)) {
    return adminJson({ error: "Provide a room_settings array" }, 400);
  }

  try {
    const supabase = createServiceRoleSupabase();

    if (Array.isArray(roomPatches)) {
      for (const raw of roomPatches) {
        if (!raw || typeof raw !== "object") {
          return adminJson({ error: "Invalid room_settings entry" }, 400);
        }
        const p = raw as PutRoomSettingPatch;
        if (!isStr(p.property_code) || !isStr(p.room_type)) {
          return adminJson(
            { error: "room_settings: property_code and room_type are required" },
            400,
          );
        }

        const updates: Record<string, string | number | boolean> = {};
        if (p.weekday_price !== undefined) {
          if (!isNonNegInt(p.weekday_price))
            return adminJson({ error: "Invalid weekday_price" }, 400);
          updates.weekday_price = p.weekday_price;
        }
        if (p.friday_price !== undefined) {
          if (!isNonNegInt(p.friday_price))
            return adminJson({ error: "Invalid friday_price" }, 400);
          updates.friday_price = p.friday_price;
        }
        if (p.saturday_price !== undefined) {
          if (!isNonNegInt(p.saturday_price))
            return adminJson({ error: "Invalid saturday_price" }, 400);
          updates.saturday_price = p.saturday_price;
        }
        if (p.extra_guest_fee !== undefined) {
          if (!isNonNegInt(p.extra_guest_fee))
            return adminJson({ error: "Invalid extra_guest_fee" }, 400);
          updates.extra_guest_fee = p.extra_guest_fee;
        }
        if (p.included_guests !== undefined) {
          if (!isNonNegInt(p.included_guests) || p.included_guests < 1) {
            return adminJson({ error: "Invalid included_guests" }, 400);
          }
          updates.included_guests = p.included_guests;
        }
        if (p.max_guests !== undefined) {
          if (!isNonNegInt(p.max_guests) || p.max_guests < 1)
            return adminJson({ error: "Invalid max_guests" }, 400);
          updates.max_guests = p.max_guests;
        }
        if (p.inventory_cap !== undefined) {
          if (!isNonNegInt(p.inventory_cap))
            return adminJson({ error: "Invalid inventory_cap" }, 400);
          updates.inventory_cap = p.inventory_cap;
        }
        if (p.is_active !== undefined) {
          if (!isBool(p.is_active))
            return adminJson({ error: "Invalid is_active" }, 400);
          updates.is_active = p.is_active;
        }
        if (p.display_name !== undefined) {
          if (typeof p.display_name !== "string" || !p.display_name.trim()) {
            return adminJson({ error: "Invalid display_name" }, 400);
          }
          updates.display_name = p.display_name.trim();
        }

        if (
          updates.included_guests !== undefined ||
          updates.max_guests !== undefined
        ) {
          const { data: row } = await supabase
            .from("public_room_settings")
            .select("included_guests, max_guests")
            .eq("property_code", p.property_code)
            .eq("room_type", p.room_type)
            .maybeSingle();
          const nextIncluded =
            updates.included_guests !== undefined
              ? (updates.included_guests as number)
              : (row?.included_guests ?? 1);
          const nextMax =
            updates.max_guests !== undefined
              ? (updates.max_guests as number)
              : (row?.max_guests ?? 1);
          if (nextIncluded > nextMax) {
            return adminJson(
              { error: "included_guests must be <= max_guests" },
              400,
            );
          }
        }

        if (Object.keys(updates).length === 0) continue;

        const { error } = await supabase
          .from("public_room_settings")
          .update(updates)
          .eq("property_code", p.property_code)
          .eq("room_type", p.room_type);

        if (error) {
          console.error("[admin/public-room-settings] PUT room", error);
          return adminJson({ error: error.message }, 500);
        }
      }
    }

    const { data: room_settings } = await supabase
      .from("public_room_settings")
      .select("*")
      .order("property_code")
      .order("room_type")
      .returns<PublicRoomSettingRow[]>();

    return adminJson({
      ok: true,
      room_settings: room_settings ?? [],
    });
  } catch (e) {
    console.error("[admin/public-room-settings] PUT", e);
    return adminJson({ error: "Internal error" }, 500);
  }
}
