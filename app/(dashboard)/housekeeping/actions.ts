"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export async function updateCleaningTask(id: string, status: string, assigneeId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "未ログインです。" };
  if (!["todo", "in_progress", "done"].includes(status)) return { error: "無効な状態です。" };
  const { data: task, error: readError } = await supabase.from("tasks")
    .select("*,reservation:reservations(status)").eq("id", id).single();
  if (readError || !task || task.superseded_at ||
      (task.reservation_id && (!task.reservation || ["cancelled", "blocked"].includes(task.reservation.status))) ||
      (task.cleaning_origin === "stay" && task.cleaning_requirement !== "required")) {
    return { error: "この清掃は更新できません。最新の予定を確認してください。" };
  }
  const payload = { status, assignee_id: assigneeId || null };
  const { error } = await supabase.from("tasks").update(payload).eq("id", id).eq("type", "cleaning").is("superseded_at", null).select("id").single();
  if (error) return { error: error.message };
  revalidatePath("/tasks");
  revalidatePath("/housekeeping");
  revalidatePath("/rooms");
  return { ok: true };
}

export async function setStayCleaningRequirement(reservationId: string, date: string, requirement: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "未ログインです。" };
  const { error } = await supabase.rpc("set_stay_cleaning_requirement", {
    p_reservation_id: reservationId, p_date: date, p_requirement: requirement,
  });
  if (error) return { error: "保存できませんでした。権限・担当・作業状態と最新の滞在日を確認してください。" };
  revalidatePath("/tasks");
  revalidatePath("/housekeeping");
  revalidatePath("/rooms");
  return { ok: true };
}
