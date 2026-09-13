import { redirect } from "next/navigation";
import { getCachedSupabaseAuth } from "@/lib/supabase/server";
import type { Reservation, Room, Property } from "@/lib/types/database";
import { reservationRevenue } from "@/lib/revenue";
import { CustomerLedger } from "./customer-ledger";

export type CustomerRow = {
  key: string; name: string; phone: string | null; email: string | null;
  stays: number; total: number; lastStay: string; notes: string[];
  history: { id: string; dates: string; property: string; room: string; amount: number; status: string }[];
};

export default async function CustomersPage() {
  const { supabase, user } = await getCachedSupabaseAuth();
  if (!user) redirect("/login");
  const { data: staff } = await supabase.from("staff").select("role").eq("id", user.id).maybeSingle();
  if (staff?.role !== "admin") redirect("/rooms");
  const [{ data: reservations }, { data: rooms }, { data: properties }] = await Promise.all([
    supabase.from("reservations").select("*").neq("status", "blocked").order("check_in_date", { ascending: false }).returns<Reservation[]>(),
    supabase.from("rooms").select("*").returns<Room[]>(),
    supabase.from("properties").select("*").returns<Property[]>(),
  ]);
  const roomMap = new Map((rooms ?? []).map((r) => [r.id, r]));
  const propertyMap = new Map((properties ?? []).map((p) => [p.id, p.name]));
  const map = new Map<string, CustomerRow>();
  for (const r of reservations ?? []) {
    const key = (r.guest_email || r.guest_phone || r.guest_name).trim().toLowerCase();
    const room = r.room_id ? roomMap.get(r.room_id) : undefined;
    const amount = reservationRevenue(r);
    const current = map.get(key) ?? { key, name: r.guest_name, phone: r.guest_phone, email: r.guest_email, stays: 0, total: 0, lastStay: r.check_out_date, notes: [], history: [] };
    current.stays += r.status === "cancelled" ? 0 : 1;
    current.total += r.status === "cancelled" ? 0 : amount;
    if (r.check_out_date > current.lastStay) current.lastStay = r.check_out_date;
    if (r.special_notes?.trim() && current.notes.length < 3) current.notes.push(r.special_notes.trim());
    current.history.push({ id: r.id, dates: `${r.check_in_date} → ${r.check_out_date}`, property: room ? propertyMap.get(room.property_id) ?? "—" : "未割当", room: room?.room_number ?? "—", amount, status: r.status });
    map.set(key, current);
  }
  return <CustomerLedger customers={[...map.values()].sort((a, b) => b.lastStay.localeCompare(a.lastStay))} />;
}
