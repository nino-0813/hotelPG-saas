import { redirect } from "next/navigation";
import { getCachedSupabaseAuth } from "@/lib/supabase/server";

export default async function DashboardIndex() {
  const { supabase, user } = await getCachedSupabaseAuth();
  if (!user) redirect("/login");

  const { data: staffRow } = await supabase
    .from("staff")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();

  redirect(staffRow?.role === "admin" ? "/reservations" : "/rooms");
}
