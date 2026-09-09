"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createServiceRoleSupabase } from "@/lib/supabase/service-role";
import { getCachedSupabaseAuth } from "@/lib/supabase/server";

async function requireAdmin() {
  const { supabase, user } = await getCachedSupabaseAuth();
  if (!user) redirect("/login");
  const { data: staff } = await supabase.from("staff").select("role").eq("id", user.id).maybeSingle();
  if (staff?.role !== "admin") redirect("/rooms");
}

function int(form: FormData, name: string, min = 0) {
  const value = Number(form.get(name));
  if (!Number.isInteger(value) || value < min) throw new Error(`${name} is invalid`);
  return value;
}

export async function updateBaseRate(form: FormData) {
  await requireAdmin();
  const propertyCode = String(form.get("property_code") ?? "");
  const roomType = String(form.get("room_type") ?? "");
  if (!propertyCode || !roomType) throw new Error("料金設定の対象が不正です");
  const { error } = await createServiceRoleSupabase().from("public_room_settings").update({
    weekday_price: int(form, "weekday_price"), friday_price: int(form, "friday_price"), saturday_price: int(form, "saturday_price"),
    included_guests: int(form, "included_guests", 1), extra_guest_fee: int(form, "extra_guest_fee"), max_guests: int(form, "max_guests", 1),
    inventory_cap: int(form, "inventory_cap"), is_active: form.get("is_active") === "on",
  }).eq("property_code", propertyCode).eq("room_type", roomType);
  if (error) throw new Error(error.message);
  revalidatePath("/pricing");
  redirect("/pricing?saved=base");
}

export async function saveSeasonalRate(form: FormData) {
  await requireAdmin();
  const id = String(form.get("id") ?? "");
  const [propertyCode, roomType] = String(form.get("target") ?? "").split("|");
  const payload = {
    property_code: propertyCode ?? "", room_type: roomType ?? "", name: String(form.get("name") ?? "").trim(),
    start_date: String(form.get("start_date") ?? ""), end_date: String(form.get("end_date") ?? ""), weekday_price: int(form, "weekday_price"),
    friday_price: int(form, "friday_price"), saturday_price: int(form, "saturday_price"), priority: int(form, "priority"), is_active: form.get("is_active") === "on",
  };
  if (!payload.property_code || !payload.room_type || !payload.name || !/^\d{4}-\d{2}-\d{2}$/.test(payload.start_date) || !/^\d{4}-\d{2}-\d{2}$/.test(payload.end_date) || payload.start_date > payload.end_date) throw new Error("季節料金の入力内容が不正です");
  const db = createServiceRoleSupabase();
  const result = id ? await db.from("public_seasonal_room_rates").update(payload).eq("id", id) : await db.from("public_seasonal_room_rates").insert(payload);
  if (result.error) throw new Error(result.error.message);
  revalidatePath("/pricing");
  redirect("/pricing?saved=seasonal");
}

export async function deleteSeasonalRate(form: FormData) {
  await requireAdmin();
  const id = String(form.get("id") ?? "");
  if (!id) throw new Error("削除対象が不正です");
  const { error } = await createServiceRoleSupabase().from("public_seasonal_room_rates").delete().eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/pricing");
  redirect("/pricing?saved=deleted");
}
