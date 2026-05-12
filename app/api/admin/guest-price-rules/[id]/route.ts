import { NextResponse, type NextRequest } from "next/server";
import { isAdminApiAuthorized } from "@/lib/admin/verify-admin-api-secret";
import { createServiceRoleSupabase } from "@/lib/supabase/service-role";

export const runtime = "nodejs";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const adminCorsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "DELETE, OPTIONS",
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

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const deny = requireAdmin(req);
  if (deny) return deny;

  const { id } = await params;
  if (!id || !UUID_RE.test(id)) {
    return adminJson({ error: "Invalid id" }, 400);
  }

  try {
    const supabase = createServiceRoleSupabase();
    const { data, error } = await supabase
      .from("public_guest_price_rules")
      .delete()
      .eq("id", id)
      .select("id");

    if (error) {
      console.error("[admin/guest-price-rules] DELETE", error);
      return adminJson({ error: error.message }, 500);
    }
    if (!data?.length) {
      return adminJson({ error: "Not found" }, 404);
    }
    return adminJson({ ok: true });
  } catch (e) {
    console.error("[admin/guest-price-rules] DELETE", e);
    return adminJson({ error: "Internal error" }, 500);
  }
}
