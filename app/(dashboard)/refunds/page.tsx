import { redirect } from "next/navigation";
import { createServiceRoleSupabase } from "@/lib/supabase/service-role";
import { getCachedSupabaseAuth } from "@/lib/supabase/server";
import { RefundManager } from "./refund-manager";

export type RefundSettings = {
  normal_policy: "full" | "deduct_processing_fee";
  processing_fee_rate: number;
  last_minute_days: number;
  last_minute_fee_type: "percentage" | "fixed";
  last_minute_fee_value: number;
};

export type RefundReservation = {
  id: string;
  guest_name: string;
  guest_email: string | null;
  check_in_date: string;
  check_out_date: string;
  stripe_session_id: string;
  rooms: { room_number: string; properties: { name: string } | null } | null;
  refund_transactions: Array<{ status: string; refund_amount: number; deducted_amount: number; stripe_refund_id: string | null; error_message: string | null }>;
};

const defaultSettings: RefundSettings = {
  normal_policy: "full",
  processing_fee_rate: 3.96,
  last_minute_days: 3,
  last_minute_fee_type: "percentage",
  last_minute_fee_value: 0,
};

export default async function RefundsPage() {
  const { supabase, user } = await getCachedSupabaseAuth();
  if (!user) redirect("/login");
  const { data: staff } = await supabase.from("staff").select("role").eq("id", user.id).maybeSingle();
  if (staff?.role !== "admin") redirect("/rooms");

  const db = createServiceRoleSupabase();
  const [{ data: settings }, { data: reservations, error }] = await Promise.all([
    db.from("refund_settings").select("normal_policy,processing_fee_rate,last_minute_days,last_minute_fee_type,last_minute_fee_value").eq("id", true).maybeSingle(),
    db.from("reservations").select("id,guest_name,guest_email,check_in_date,check_out_date,stripe_session_id,rooms(room_number,properties(name)),refund_transactions(status,refund_amount,deducted_amount,stripe_refund_id,error_message)").eq("status", "cancelled").not("stripe_session_id", "is", null).order("guest_cancelled_at", { ascending: false }).limit(100),
  ]);

  return <RefundManager settings={(settings as RefundSettings | null) ?? defaultSettings} reservations={(reservations as unknown as RefundReservation[] | null) ?? []} loadError={error?.message ?? null} />;
}
