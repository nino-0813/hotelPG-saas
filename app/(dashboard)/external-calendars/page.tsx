import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type {
  ExternalCalendar,
  Property,
} from "@/lib/types/database";
import { CalendarList } from "./calendar-list";

export default async function ExternalCalendarsPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: staffRow } = await supabase
    .from("staff")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();

  if (staffRow?.role !== "admin") {
    return (
      <main className="px-4 py-6 sm:px-6">
        <div className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          このページは管理者のみ閲覧できます。
        </div>
      </main>
    );
  }

  const [{ data: properties }, { data: calendars }] = await Promise.all([
    supabase
      .from("properties")
      .select("*")
      .order("display_order")
      .returns<Property[]>(),
    supabase
      .from("external_calendars")
      .select("*")
      .order("created_at", { ascending: false })
      .returns<ExternalCalendar[]>(),
  ]);

  return (
    <main className="px-4 py-4 sm:px-6 sm:py-6">
      <div className="mb-4">
        <h1 className="text-xl font-semibold tracking-tight">
          外部カレンダー連携
        </h1>
        <p className="mt-0.5 text-sm text-neutral-500">
          楽天お宿などの ics URL を登録すると、予約が自動で取り込まれます。
          取り込んだ予約は <strong>未割当</strong>{" "}
          として保存され、画面で部屋とキー番号を割り当てると有効化します。
        </p>
      </div>

      <CalendarList
        properties={properties ?? []}
        calendars={calendars ?? []}
      />
    </main>
  );
}
