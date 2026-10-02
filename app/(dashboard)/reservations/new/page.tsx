import { format } from "date-fns";
import { redirect } from "next/navigation";
import { getCachedSupabaseAuth } from "@/lib/supabase/server";
import type { Property, Room } from "@/lib/types/database";
import { ReservationViewTabs } from "../reservation-view-tabs";
import { NewReservationPageForm } from "./reservation-new-form";

type SearchParams = Promise<{ date?: string | string[]; room?: string | string[] }>;

export default async function NewReservationPage({ searchParams }: { searchParams: SearchParams }) {
  const { supabase, user } = await getCachedSupabaseAuth();
  if (!user) redirect("/login");
  const { data: staff } = await supabase.from("staff").select("role").eq("id", user.id).maybeSingle();
  if (staff?.role !== "admin") redirect("/rooms");

  const [{ data: properties }, { data: rooms }] = await Promise.all([
    supabase.from("properties").select("*").order("display_order").returns<Property[]>(),
    supabase.from("rooms").select("*").order("display_order").returns<Room[]>(),
  ]);
  const params = await searchParams;
  const requestedDate = typeof params.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(params.date) ? params.date : format(new Date(), "yyyy-MM-dd");
  const requestedRoomId = typeof params.room === "string" && (rooms ?? []).some((room) => room.id === params.room) ? params.room : undefined;

  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-4 sm:px-6 sm:py-6">
      <h1 className="text-xl font-semibold tracking-tight">新規予約追加</h1>
      <p className="mt-1 text-sm text-neutral-500">ここで登録した予約は予約一覧とカレンダーに反映されます。</p>
      <div className="mt-4"><ReservationViewTabs active="new" /></div>
      <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm">
        <NewReservationPageForm
          date={requestedDate}
          roomId={requestedRoomId}
          rooms={rooms ?? []}
          properties={properties ?? []}
        />
      </div>
    </main>
  );
}
