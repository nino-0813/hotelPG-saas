"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { TaskStatus } from "@/lib/types/database";

export async function updateTaskStatus(taskId: string, status: TaskStatus) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("tasks")
    .update({ status })
    .eq("id", taskId);

  if (error) return { error: error.message };

  revalidatePath("/tasks");
  return { ok: true };
}

export async function assignTaskToMe(taskId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "未ログイン" };

  const { error } = await supabase
    .from("tasks")
    .update({ assignee_id: user.id })
    .eq("id", taskId);

  if (error) return { error: error.message };

  revalidatePath("/tasks");
  return { ok: true };
}

export async function unassignTask(taskId: string) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("tasks")
    .update({ assignee_id: null })
    .eq("id", taskId);

  if (error) return { error: error.message };

  revalidatePath("/tasks");
  return { ok: true };
}
