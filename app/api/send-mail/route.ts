import { NextRequest, NextResponse } from "next/server";
import { sendMail } from "@/lib/gmail";
import { createRouteHandlerSupabaseClient } from "@/lib/supabase/route-handler";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const supabase = await createRouteHandlerSupabaseClient();

    const {
      data: { user },
      error: authErr,
    } = await supabase.auth.getUser();

    if (authErr || !user) {
      return NextResponse.json(
        { success: false, error: "ログインが必要です" },
        { status: 401 },
      );
    }

    const { data: staffRow } = await supabase
      .from("staff")
      .select("role")
      .eq("id", user.id)
      .maybeSingle();

    if (staffRow?.role !== "admin") {
      return NextResponse.json(
        { success: false, error: "送信権限がありません" },
        { status: 403 },
      );
    }

    const body = (await req.json()) as {
      to?: unknown;
      subject?: unknown;
      message?: unknown;
    };

    const to =
      typeof body.to === "string" ? body.to.trim() : "";
    const subject =
      typeof body.subject === "string" ? body.subject.trim() : "";
    const message =
      typeof body.message === "string" ? body.message : "";

    if (!to || !subject || !message) {
      return NextResponse.json(
        {
          success: false,
          error: "to, subject, message がすべて必要です",
        },
        { status: 400 },
      );
    }

    await sendMail(to, subject, message);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[send-mail]", error);

    const msg =
      error instanceof Error ? error.message : "Failed to send mail";

    return NextResponse.json(
      {
        success: false,
        error: msg,
      },
      { status: 500 },
    );
  }
}
