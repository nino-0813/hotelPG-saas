import type { SupabaseClient } from "@supabase/supabase-js";

export type StripeWebhookLogRow = {
  event_type: string;
  event_id: string | null;
  stripe_session_id: string;
  level: "info" | "warn" | "error";
  message: string;
  property_code?: string | null;
  room_type?: string | null;
  check_in_date?: string | null;
  check_out_date?: string | null;
  reason?: string | null;
  assigned_room_id?: string | null;
  has_smart_key_code?: boolean | null;
};

export async function insertStripeWebhookLog(
  supabase: SupabaseClient,
  row: StripeWebhookLogRow,
): Promise<void> {
  try {
    await supabase.from("webhook_event_logs").insert({
      source: "stripe",
      event_type: row.event_type,
      event_id: row.event_id,
      session_id: row.stripe_session_id,
      stripe_session_id: row.stripe_session_id,
      level: row.level,
      message: row.message.slice(0, 500),
      property_code: row.property_code ?? null,
      room_type: row.room_type ?? null,
      check_in_date: row.check_in_date ?? null,
      check_out_date: row.check_out_date ?? null,
      reason: row.reason ? row.reason.slice(0, 200) : null,
      assigned_room_id: row.assigned_room_id ?? null,
      has_smart_key_code: row.has_smart_key_code ?? null,
    });
  } catch (e) {
    console.error("[stripe/webhook] webhook_event_logs insert failed", e);
  }
}
