import { redirect } from "next/navigation";
import { getCachedSupabaseAuth } from "@/lib/supabase/server";
import type { Property, Reservation, ReservationStatus, Room } from "@/lib/types/database";
import { ReservationViewTabs } from "../reservation-view-tabs";
import { ReservationList } from "./reservation-list";

type SearchParams = Promise<{
  q?: string;
  status?: string;
  property?: string;
  source?: string;
  from?: string;
  to?: string;
}>;

const VALID_STATUSES = new Set<ReservationStatus>([
  "confirmed", "checked_in", "checked_out", "cancelled", "blocked",
]);

export default async function ReservationListPage({ searchParams }: { searchParams: SearchParams }) {
  const { supabase, user } = await getCachedSupabaseAuth();
  if (!user) redirect("/login");
  const { data: staff } = await supabase.from("staff").select("role").eq("id", user.id).maybeSingle();
  if (staff?.role !== "admin") redirect("/rooms");

  const params = await searchParams;
  const [{ data: properties }, { data: rooms }] = await Promise.all([
    supabase.from("properties").select("*").order("display_order").returns<Property[]>(),
    supabase.from("rooms").select("*").order("display_order").returns<Room[]>(),
  ]);

  const q = params.q?.trim().toLocaleLowerCase("ja") ?? "";
  const status = VALID_STATUSES.has(params.status as ReservationStatus) ? params.status as ReservationStatus : "all";
  const property = params.property || "all";
  const source = params.source || "all";
  const roomById = new Map((rooms ?? []).map((room) => [room.id, room]));

  let reservationsQuery = supabase
    .from("reservations")
    .select("*")
    .order("check_in_date", { ascending: false })
    .limit(1000);

  if (status !== "all") reservationsQuery = reservationsQuery.eq("status", status);
  if (source !== "all") {
    reservationsQuery = source === "unknown"
      ? reservationsQuery.is("source", null)
      : reservationsQuery.eq("source", source);
  }
  if (params.from) reservationsQuery = reservationsQuery.gte("check_in_date", params.from);
  if (params.to) reservationsQuery = reservationsQuery.lte("check_out_date", params.to);
  if (property !== "all") {
    const roomIds = (rooms ?? [])
      .filter((room) => room.property_id === property)
      .map((room) => room.id);
    reservationsQuery = roomIds.length > 0
      ? reservationsQuery.in("room_id", roomIds)
      : reservationsQuery.eq("requested_property_id", property);
  }

  const { data: rawReservations } = await reservationsQuery.returns<Reservation[]>();

  const reservations = (rawReservations ?? []).filter((reservation) => {
    const room = reservation.room_id ? roomById.get(reservation.room_id) : undefined;
    if (!q) return true;
    return [reservation.guest_name, reservation.guest_phone, reservation.guest_email, reservation.smart_key_code, reservation.source, room?.room_number]
      .some((value) => value?.toLocaleLowerCase("ja").includes(q));
  });

  const { data: allSources } = await supabase.from("reservations").select("source");
  const sourceOptions = Array.from(new Set((allSources ?? []).map((row) => row.source || "unknown"))).sort();
  const hasFilters = Boolean(q || status !== "all" || property !== "all" || source !== "all" || params.from || params.to);
  const downloadParams = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === "string" && value) downloadParams.set(key, value);
  }

  return (
    <main className="mx-auto w-full max-w-[1500px] px-4 py-4 sm:px-6 sm:py-6">
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">予約一覧</h1>
          <p className="mt-1 text-sm text-neutral-500">宿泊日、お客様、ステータスから予約を探して、詳細確認や編集ができます。</p>
        </div>
        <div className="flex items-center gap-3">
          <a
            href={`/api/reservations/csv${downloadParams.size ? `?${downloadParams}` : ""}`}
            className="inline-flex min-h-10 items-center rounded-lg border border-neutral-300 bg-white px-4 text-sm font-medium text-neutral-800 hover:bg-neutral-50"
          >
            CSVダウンロード
          </a>
          <p className="text-sm font-medium tabular-nums text-neutral-600">{reservations.length}件表示</p>
        </div>
      </div>

      <ReservationViewTabs active="list" />

      <form className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm" aria-label="予約の検索条件">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[minmax(240px,1.6fr)_repeat(5,minmax(125px,1fr))_auto]">
          <label className="text-xs font-medium text-neutral-600">キーワード
            <span className="relative mt-1 block"><svg aria-hidden="true" viewBox="0 0 20 20" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="9" cy="9" r="5.5"/><path d="m13 13 4 4"/></svg><input name="q" defaultValue={params.q} className="min-h-11 w-full rounded-lg border border-neutral-300 pl-9 pr-3 text-base focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-100 sm:text-sm" placeholder="氏名・電話・メール・鍵番号" /></span>
          </label>
          <FilterSelect label="ステータス" name="status" value={status} options={[["all", "すべて"], ["confirmed", "未到着"], ["checked_in", "滞在中"], ["checked_out", "出発済み"], ["cancelled", "キャンセル"], ["blocked", "在庫停止"]]} />
          <FilterSelect label="施設" name="property" value={property} options={[["all", "全施設"], ...(properties ?? []).map((p) => [p.id, p.name])]} />
          <FilterSelect label="予約経路" name="source" value={source} options={[["all", "全経路"], ...sourceOptions.map((item) => [item, sourceLabel(item === "unknown" ? null : item)])]} />
          <DateField label="宿泊開始" name="from" value={params.from} />
          <DateField label="宿泊終了" name="to" value={params.to} />
          <div className="flex items-end gap-2 md:col-span-2 xl:col-span-1"><button className="min-h-11 flex-1 rounded-lg bg-neutral-900 px-5 text-sm font-semibold text-white hover:bg-neutral-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-900">検索</button><a href="/reservations/list" className="flex min-h-11 items-center rounded-lg border border-neutral-300 px-4 text-sm font-medium text-neutral-700 hover:bg-neutral-50">クリア</a></div>
        </div>
      </form>

      {hasFilters ? (
        <div className="mt-3 flex items-center justify-between gap-3 rounded-lg border border-blue-200 bg-blue-50 px-4 py-2.5 text-sm text-blue-900">
          <p><span className="font-semibold">絞り込み中:</span> 条件に一致する{reservations.length}件のみを表示しています。</p>
          <a href="/reservations/list" className="shrink-0 font-medium underline underline-offset-2">解除</a>
        </div>
      ) : null}

      <ReservationList reservations={reservations} properties={properties ?? []} rooms={rooms ?? []} />
    </main>
  );
}

function FilterSelect({ label, name, value, options }: { label: string; name: string; value: string; options: string[][] }) {
  return <label className="text-xs font-medium text-neutral-600">{label}<select name={name} defaultValue={value} className="mt-1 min-h-11 w-full rounded-lg border border-neutral-300 bg-white px-3 text-base focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-100 sm:text-sm">{options.map(([key, text]) => <option key={key} value={key}>{text}</option>)}</select></label>;
}

function DateField({ label, name, value }: { label: string; name: string; value?: string }) {
  return <label className="text-xs font-medium text-neutral-600">{label}<input type="date" name={name} defaultValue={value} className="mt-1 min-h-11 w-full rounded-lg border border-neutral-300 px-3 text-base focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-100 sm:text-sm" /></label>;
}

export function sourceLabel(source: string | null) {
  if (!source) return "不明・未設定";
  const labels: Record<string, string> = { stripe_web: "公式Web", rakuten_oyado: "楽天", manual: "手入力", booking_com: "Booking.com", airbnb: "Airbnb" };
  return labels[source] ?? source;
}
