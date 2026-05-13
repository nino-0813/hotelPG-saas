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
      /** When set with mailKind, records send on reservation + audit log */
      reservationId?: unknown;
      mailKind?: unknown;
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

    const reservationIdRaw = body.reservationId;
    const mailKindRaw = body.mailKind;
    if (
      typeof reservationIdRaw === "string" &&
      (mailKindRaw === "check_in" ||
        mailKindRaw === "reservation_confirmed")
    ) {
      const reservationId = reservationIdRaw.trim();
      const uuidRe =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (uuidRe.test(reservationId)) {
        const { data: exists, error: selErr } = await supabase
          .from("reservations")
          .select("id")
          .eq("id", reservationId)
          .maybeSingle();

        if (!selErr && exists?.id) {
          const nowIso = new Date().toISOString();
          const patch =
            mailKindRaw === "check_in"
              ? { guest_mail_check_in_sent_at: nowIso }
              : { guest_mail_reservation_confirmed_sent_at: nowIso };
          const { error: upErr } = await supabase
            .from("reservations")
            .update(patch)
            .eq("id", reservationId);
          if (upErr) {
            console.error("[send-mail] reservation timestamp update failed", upErr);
          }

          const logAction =
            mailKindRaw === "check_in"
              ? "mail_check_in_sent"
              : "mail_reservation_confirmed_sent";
          const { error: logErr } = await supabase.from("reservation_logs").insert({
            reservation_id: reservationId,
            action: logAction,
          });
          if (logErr) {
            console.error("[send-mail] reservation_logs insert failed", logErr);
          }
        }
      }
    }

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
