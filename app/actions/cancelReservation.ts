"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export async function cancelReservation(reservationId: string): Promise<true> {
  const id = reservationId.trim();
  if (!id) throw new Error("reservationId is required");

  const supabase = await createClient();

  // Safety: no-op if already cancelled.
  const { data: current, error: curErr } = await supabase
    .from("reservations")
    .select("status")
    .eq("id", id)
    .single();
  if (curErr) throw new Error(curErr.message);
  if (current?.status === "cancelled") {
    console.log("[cancelReservation] already cancelled:", id);
    return true;
  }

  const { data: updateData, error: updateError } = await supabase
    .from("reservations")
    .update({ status: "cancelled" })
    .eq("id", id)
    .select("id, status")
    .single();

  console.log("[cancelReservation] update result:", updateData);
  console.log("[cancelReservation] update error:", updateError);

  if (updateError) throw new Error(updateError.message);
  if (updateData?.status !== "cancelled") {
    throw new Error("cancelReservation failed: status was not updated");
  }

  const { data: after, error: afterErr } = await supabase
    .from("reservations")
    .select("status")
    .eq("id", id)
    .single();
  console.log("[cancelReservation] status after update:", after?.status ?? null);
  if (afterErr) console.error("[cancelReservation] select after update failed", afterErr.message);

  const { error: logErr } = await supabase.from("reservation_logs").insert({
    reservation_id: id,
    action: "cancelled",
  });
  if (logErr) console.error("[reservation_logs] insert failed", logErr.message);

  console.log("[cancelReservation] cancelled:", id);
  revalidatePath("/reservations");
  revalidatePath("/tasks");
  return true;
}

// Future: physical delete should be admin-only.

