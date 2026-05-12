import { NextResponse, type NextRequest } from "next/server";
import { isAdminApiAuthorized } from "@/lib/admin/verify-admin-api-secret";
import { createServiceRoleSupabase } from "@/lib/supabase/service-role";
import type { PublicGuestPriceRuleRow } from "@/lib/types/public-catalog";

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

function isNonNegInt(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n) && n >= 0;
}

function isStr(n: unknown): n is string {
  return typeof n === "string" && n.length > 0;
}

function isBool(n: unknown): n is boolean {
  return typeof n === "boolean";
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
      .from("public_guest_price_rules")
      .select("*")
      .order("property_code")
      .order("room_type")
      .order("min_guests");

    if (pc) q = q.eq("property_code", pc.trim());
    if (rt) q = q.eq("room_type", rt.trim());

    const { data, error } = await q.returns<PublicGuestPriceRuleRow[]>();
    if (error) {
      console.error("[admin/guest-price-rules] GET", error);
      return adminJson({ error: "Failed to load guest price rules" }, 500);
    }
    return adminJson({ guest_price_rules: data ?? [] });
  } catch (e) {
    console.error("[admin/guest-price-rules] GET", e);
    return adminJson({ error: "Internal error" }, 500);
  }
}

type GuestRulePatch = {
  id?: string;
  property_code: string;
  room_type: string;
  min_guests: number;
  max_guests: number;
  weekday_price: number;
  friday_price: number;
  saturday_price: number;
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

  const rows = (body as { guest_price_rules?: unknown }).guest_price_rules;
  if (!Array.isArray(rows) || rows.length === 0) {
    return adminJson({ error: "Provide guest_price_rules array" }, 400);
  }

  const supabase = createServiceRoleSupabase();

  for (const raw of rows) {
    if (!raw || typeof raw !== "object") {
      return adminJson({ error: "Invalid guest_price_rules entry" }, 400);
    }
    const p = raw as GuestRulePatch;

    if (!isStr(p.property_code) || !isStr(p.room_type)) {
      return adminJson(
        { error: "property_code and room_type are required" },
        400,
      );
    }
    if (
      !isNonNegInt(p.min_guests) ||
      !isNonNegInt(p.max_guests) ||
      p.min_guests < 1
    ) {
      return adminJson({ error: "min_guests and max_guests must be integers >= 1" }, 400);
    }
    if (p.min_guests > p.max_guests) {
      return adminJson({ error: "min_guests must be <= max_guests" }, 400);
    }
    if (
      !isNonNegInt(p.weekday_price) ||
      !isNonNegInt(p.friday_price) ||
      !isNonNegInt(p.saturday_price)
    ) {
      return adminJson(
        { error: "weekday_price, friday_price, saturday_price must be non-negative integers" },
        400,
      );
    }

    let isActive = true;
    if (p.is_active !== undefined) {
      if (!isBool(p.is_active)) return adminJson({ error: "Invalid is_active" }, 400);
      isActive = p.is_active;
    }
    const priority =
      typeof p.priority === "number" && Number.isInteger(p.priority)
        ? p.priority
        : 100;

    const payload = {
      property_code: p.property_code.trim(),
      room_type: p.room_type.trim(),
      min_guests: p.min_guests,
      max_guests: p.max_guests,
      weekday_price: p.weekday_price,
      friday_price: p.friday_price,
      saturday_price: p.saturday_price,
      is_active: isActive,
      priority,
    };

    if (p.id) {
      if (!UUID_RE.test(p.id)) {
        return adminJson({ error: "Invalid id" }, 400);
      }
      const { error } = await supabase
        .from("public_guest_price_rules")
        .update(payload)
        .eq("id", p.id);
      if (error) {
        console.error("[admin/guest-price-rules] PUT update", error);
        return adminJson({ error: error.message }, 500);
      }
    } else {
      const { error } = await supabase.from("public_guest_price_rules").insert(payload);
      if (error) {
        console.error("[admin/guest-price-rules] PUT insert", error);
        return adminJson({ error: error.message }, 500);
      }
    }
  }

  const { data, error } = await supabase
    .from("public_guest_price_rules")
    .select("*")
    .order("property_code")
    .order("room_type")
    .order("min_guests")
    .returns<PublicGuestPriceRuleRow[]>();

  if (error) {
    return adminJson({ error: error.message }, 500);
  }

  return adminJson({ ok: true, guest_price_rules: data ?? [] });
}
