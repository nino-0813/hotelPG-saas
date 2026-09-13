"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export async function updateCleaningTask(id: string, status: string, assigneeId: string) {
  const supabase = await createClient();
  const payload = { status, assignee_id: assigneeId || null, completed_at: status === "done" ? new Date().toISOString() : null };
  const { error } = await supabase.from("tasks").update(payload).eq("id", id).eq("type", "cleaning");
  if (error) return { error: error.message };
  revalidatePath("/housekeeping");
  revalidatePath("/rooms");
  return { ok: true };
}
