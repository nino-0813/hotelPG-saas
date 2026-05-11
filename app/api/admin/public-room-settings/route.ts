import { NextResponse, type NextRequest } from "next/server";
import { isAdminApiAuthorized } from "@/lib/admin/verify-admin-api-secret";
import { createServiceRoleSupabase } from "@/lib/supabase/service-role";
import type {
  PublicInventoryCapRow,
  PublicRoomSettingRow,
} from "@/lib/types/public-catalog";

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
    const [{ data: room_settings, error: rsErr }, { data: inventory_caps, error: icErr }] =
      await Promise.all([
        supabase
          .from("public_room_settings")
          .select("*")
          .order("property_code")
          .order("room_type")
          .returns<PublicRoomSettingRow[]>(),
        supabase
          .from("public_inventory_caps")
          .select("*")
          .order("property_code")
          .order("room_type")
          .order("min_guests")
          .returns<PublicInventoryCapRow[]>(),
      ]);

    if (rsErr || icErr) {
      console.error("[admin/public-room-settings] GET", rsErr, icErr);
      return adminJson({ error: "Failed to load settings" }, 500);
    }

    return adminJson({
      room_settings: room_settings ?? [],
      inventory_caps: inventory_caps ?? [],
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
  extra_guest_fee?: number;
  max_guests?: number;
  inventory_cap?: number;
  is_active?: boolean;
  display_name?: string;
};

type PutInventoryCapPatch = {
  property_code: string;
  room_type: string;
  min_guests: number;
  max_guests: number;
  inventory_cap: number;
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
  const capPatches = (body as { inventory_caps?: unknown }).inventory_caps;

  if (!Array.isArray(roomPatches) && !Array.isArray(capPatches)) {
    return adminJson(
      { error: "Provide room_settings and/or inventory_caps arrays" },
      400,
    );
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

    if (Array.isArray(capPatches)) {
      for (const raw of capPatches) {
        if (!raw || typeof raw !== "object") {
          return adminJson({ error: "Invalid inventory_caps entry" }, 400);
        }
        const c = raw as PutInventoryCapPatch;
        if (
          !isStr(c.property_code) ||
          !isStr(c.room_type) ||
          !isNonNegInt(c.min_guests) ||
          !isNonNegInt(c.max_guests) ||
          !isNonNegInt(c.inventory_cap)
        ) {
          return adminJson(
            {
              error:
                "inventory_caps: property_code, room_type, min_guests, max_guests, inventory_cap required",
            },
            400,
          );
        }
        if (c.min_guests < 1 || c.max_guests < c.min_guests) {
          return adminJson({ error: "Invalid guest range" }, 400);
        }

        const { error } = await supabase.from("public_inventory_caps").upsert(
          {
            property_code: c.property_code,
            room_type: c.room_type,
            min_guests: c.min_guests,
            max_guests: c.max_guests,
            inventory_cap: c.inventory_cap,
          },
          {
            onConflict: "property_code,room_type,min_guests,max_guests",
          },
        );

        if (error) {
          console.error("[admin/public-room-settings] PUT cap", error);
          return adminJson({ error: error.message }, 500);
        }
      }
    }

    const [{ data: room_settings }, { data: inventory_caps }] =
      await Promise.all([
        supabase
          .from("public_room_settings")
          .select("*")
          .order("property_code")
          .order("room_type")
          .returns<PublicRoomSettingRow[]>(),
        supabase
          .from("public_inventory_caps")
          .select("*")
          .order("property_code")
          .order("room_type")
          .order("min_guests")
          .returns<PublicInventoryCapRow[]>(),
      ]);

    return adminJson({
      ok: true,
      room_settings: room_settings ?? [],
      inventory_caps: inventory_caps ?? [],
    });
  } catch (e) {
    console.error("[admin/public-room-settings] PUT", e);
    return adminJson({ error: "Internal error" }, 500);
  }
}
