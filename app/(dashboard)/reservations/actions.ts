"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type {
  PaymentMethod,
  ReservationStatus,
} from "@/lib/types/database";

export type CreateReservationInput = {
  room_id: string;
  guest_name: string;
  guest_phone?: string;
  guest_count: number;
  check_in_date: string;
  check_in_time?: string;
  check_out_date: string;
  check_out_time?: string;
  payment_method: PaymentMethod;
  smart_key_code?: string;
  special_notes?: string;
  source?: string;
};

export async function createReservation(input: CreateReservationInput) {
  const supabase = await createClient();

  const payload = {
    room_id: input.room_id,
    guest_name: input.guest_name.trim(),
    guest_phone: input.guest_phone?.trim() || null,
    guest_count: input.guest_count,
    check_in_date: input.check_in_date,
    check_in_time: input.check_in_time || "15:00",
    check_out_date: input.check_out_date,
    check_out_time: input.check_out_time || "11:00",
    payment_method: input.payment_method,
    smart_key_code: input.smart_key_code?.trim() || null,
    special_notes: input.special_notes?.trim() || null,
    source: input.source?.trim() || "manual",
    status: "confirmed" as const,
  };

  const { data, error } = await supabase
    .from("reservations")
    .insert(payload)
    .select("id")
    .single();

  console.log("[createReservation] insert result:", { data, error });
  console.log("[createReservation] insert ok:", !error);
  console.log("[createReservation] reservation id:", data?.id ?? null);

  if (error) return { error: error.message };

  if (data?.id) {
    const { error: logErr } = await supabase.from("reservation_logs").insert({
      reservation_id: data.id,
      action: "created",
    });
    if (logErr) console.error("[reservation_logs] insert failed", logErr.message);
  }

  revalidatePath("/reservations");
  revalidatePath("/tasks");
  return { ok: true, id: data?.id };
}

export type UpdateReservationInput = Partial<CreateReservationInput> & {
  id: string;
};

export async function updateReservation(input: UpdateReservationInput) {
  const supabase = await createClient();
  const { id, ...rest } = input;

  const payload: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(rest)) {
    if (v === undefined) continue;
    if (typeof v === "string") {
      payload[k] = v.trim() || null;
    } else {
      payload[k] = v;
    }
  }

  const { error } = await supabase
    .from("reservations")
    .update(payload)
    .eq("id", id);

  if (error) return { error: error.message };

  revalidatePath("/reservations");
  revalidatePath("/tasks");
  return { ok: true };
}

export async function changeReservationStatus(
  id: string,
  status: ReservationStatus,
) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("reservations")
    .update({ status })
    .eq("id", id);

  if (error) return { error: error.message };

  revalidatePath("/reservations");
  revalidatePath("/tasks");
  return { ok: true };
}

export async function deleteReservation(id: string) {
  const supabase = await createClient();
  const { error } = await supabase.from("reservations").delete().eq("id", id);

  if (error) return { error: error.message };

  revalidatePath("/reservations");
  revalidatePath("/tasks");
  return { ok: true };
}

export type AssignReservationInput = {
  id: string;
  room_id: string;
  smart_key_code?: string;
  special_notes?: string;
};

/**
 * Assign a room and key code to a pending (room_id = NULL) reservation.
 * The DB trigger fires task generation as soon as room_id transitions to a value.
 */
export async function assignReservationRoom(input: AssignReservationInput) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("reservations")
    .update({
      room_id: input.room_id,
      smart_key_code: input.smart_key_code?.trim() || null,
      special_notes: input.special_notes?.trim() || null,
    })
    .eq("id", input.id);

  if (error) return { error: error.message };

  revalidatePath("/reservations");
  revalidatePath("/tasks");
  return { ok: true };
}
