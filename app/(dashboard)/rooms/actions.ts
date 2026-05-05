"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { RoomStatusValue } from "@/lib/types/database";

export async function updateRoomStatus(
  roomId: string,
  status: RoomStatusValue,
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { error } = await supabase
    .from("room_status")
    .update({ status, updated_by: user?.id ?? null })
    .eq("room_id", roomId);

  if (error) return { error: error.message };

  revalidatePath("/rooms");
  return { ok: true };
}
