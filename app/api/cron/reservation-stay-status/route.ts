import { NextResponse, type NextRequest } from "next/server";
import { revalidatePath } from "next/cache";
import { createServiceRoleSupabase } from "@/lib/supabase/service-role";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function getCronSecret(): string | null {
  const s = process.env.CRON_SECRET?.trim();
  if (!s || s.length < 8) return null;
  return s;
}

function tokenMatches(req: NextRequest, secret: string): boolean {
  const auth = req.headers.get("authorization");
  const bearer =
    auth?.startsWith("Bearer ") ? auth.slice(7).trim() : null;
  const header = req.headers.get("x-cron-secret")?.trim();
  const token = bearer || header;
  return token === secret;
}

async function run() {
  const supabase = createServiceRoleSupabase();
  const { data, error } = await supabase.rpc(
    "auto_transition_reservation_stay_statuses",
  );

  if (error) {
    console.error("[cron/reservation-stay-status]", error);
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 500 },
    );
  }

  revalidatePath("/rooms");
  revalidatePath("/reservations");
  revalidatePath("/tasks");

  return NextResponse.json({ ok: true, result: data ?? null });
}

/** Vercel Cron uses GET + Authorization: Bearer CRON_SECRET when CRON_SECRET is set. */
export async function GET(req: NextRequest) {
  const secret = getCronSecret();
  if (!secret) {
    return NextResponse.json(
      { ok: false, error: "CRON_SECRET is not set (min 8 characters)." },
      { status: 503 },
    );
  }
  if (!tokenMatches(req, secret)) {
    return NextResponse.json(
      { ok: false, error: "Unauthorized" },
      { status: 401 },
    );
  }
  return run();
}

export async function POST(req: NextRequest) {
  const secret = getCronSecret();
  if (!secret) {
    return NextResponse.json(
      { ok: false, error: "CRON_SECRET is not set (min 8 characters)." },
      { status: 503 },
    );
  }
  if (!tokenMatches(req, secret)) {
    return NextResponse.json(
      { ok: false, error: "Unauthorized" },
      { status: 401 },
    );
  }
  return run();
}
