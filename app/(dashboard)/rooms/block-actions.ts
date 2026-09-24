"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export async function createRoomBlock(formData: FormData) {
  const db = await createClient();
  const room_id = String(formData.get("room_id") ?? "");
  const start_date = String(formData.get("start_date") ?? "");
  const end_date = String(formData.get("end_date") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();
  if (!room_id || !start_date || !end_date || end_date < start_date) return;
  const { data: reservations } = await db.from("reservations").select("id,guest_name").eq("room_id", room_id).neq("status", "cancelled").lt("check_in_date", end_date).gt("check_out_date", start_date).limit(1);
  if (reservations?.length) throw new Error(`この期間には予約があります（${reservations[0].guest_name}）。先に部屋変更を行ってください。`);
  const { error } = await db.from("room_blocks").insert({ room_id, start_date, end_date, reason: reason || null });
  if (error) throw new Error(error.message);
  revalidatePath("/rooms"); revalidatePath("/reservations"); revalidatePath("/reports"); revalidatePath("/rakuten-inventory");
}

export async function disableRoomBlock(formData: FormData) {
  const db = await createClient();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const { error } = await db.from("room_blocks").update({ is_active: false, updated_at: new Date().toISOString() }).eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/rooms"); revalidatePath("/reservations"); revalidatePath("/reports"); revalidatePath("/rakuten-inventory");
}
