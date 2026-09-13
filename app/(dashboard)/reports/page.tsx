import { addDays, differenceInCalendarDays, format, parseISO } from "date-fns";
import { redirect } from "next/navigation";
import { getCachedSupabaseAuth } from "@/lib/supabase/server";
import type { Property, Reservation, Room } from "@/lib/types/database";
import { reservationRevenue, reservationTax, sourceLabel } from "@/lib/revenue";

type SearchParams = Promise<{ start?: string; end?: string; property?: string }>;
type ReportReservation = Pick<Reservation, "id" | "room_id" | "requested_property_id" | "check_in_date" | "check_out_date" | "status" | "source" | "payment_method" | "special_notes">;

const yen = new Intl.NumberFormat("ja-JP", { style: "currency", currency: "JPY", maximumFractionDigits: 0 });

function overlapNights(row: ReportReservation, start: Date, endExclusive: Date) {
  const arrival = parseISO(row.check_in_date);
  const departure = parseISO(row.check_out_date);
  const from = arrival > start ? arrival : start;
  const to = departure < endExclusive ? departure : endExclusive;
  return Math.max(0, differenceInCalendarDays(to, from));
}

export default async function ReportsPage({ searchParams }: { searchParams: SearchParams }) {
  const { supabase, user } = await getCachedSupabaseAuth();
  if (!user) redirect("/login");
  const { data: staff } = await supabase.from("staff").select("role").eq("id", user.id).maybeSingle();
  if (staff?.role !== "admin") redirect("/rooms");

  const params = await searchParams;
  const today = new Date();
  const defaultStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const start = params.start ? parseISO(params.start) : defaultStart;
  const requestedEnd = params.end ? parseISO(params.end) : today;
  const end = requestedEnd < start ? start : requestedEnd;
  const endExclusive = addDays(end, 1);
  const days = Math.max(1, differenceInCalendarDays(endExclusive, start));

  const [{ data: properties }, { data: rooms }, { data: reservations }] = await Promise.all([
    supabase.from("properties").select("*").order("display_order").returns<Property[]>(),
    supabase.from("rooms").select("*").order("display_order").returns<Room[]>(),
    supabase.from("reservations").select("id, room_id, requested_property_id, check_in_date, check_out_date, status, source, payment_method, special_notes")
      .neq("status", "cancelled").neq("status", "blocked").lt("check_in_date", format(endExclusive, "yyyy-MM-dd"))
      .gt("check_out_date", format(start, "yyyy-MM-dd")).returns<ReportReservation[]>(),
  ]);

  const allProperties = properties ?? [];
  const selectedProperty = params.property && allProperties.some((p) => p.id === params.property) ? params.property : "all";
  const scopedRooms = (rooms ?? []).filter((room) => selectedProperty === "all" || room.property_id === selectedProperty);
  const roomById = new Map((rooms ?? []).map((room) => [room.id, room]));
  const scopedReservations = (reservations ?? []).filter((row) => {
    const propertyId = row.room_id ? roomById.get(row.room_id)?.property_id : row.requested_property_id;
    return selectedProperty === "all" || propertyId === selectedProperty;
  });

  const soldRoomNights = scopedReservations.reduce((sum, row) => sum + overlapNights(row, start, endExclusive), 0);
  const availableRoomNights = scopedRooms.length * days;
  const occupancy = availableRoomNights ? Math.min(100, soldRoomNights / availableRoomNights * 100) : 0;
  const totalSales = scopedReservations.reduce((sum, row) => sum + reservationRevenue(row), 0);
  const taxTotal = scopedReservations.reduce((sum, row) => sum + reservationTax(row).total, 0);
  const adr = soldRoomNights ? Math.round(totalSales / soldRoomNights) : 0;

  const propertyRows = allProperties.filter((p) => selectedProperty === "all" || p.id === selectedProperty).map((property) => {
    const propertyRooms = scopedRooms.filter((room) => room.property_id === property.id);
    const ids = new Set(propertyRooms.map((room) => room.id));
    const rows = scopedReservations.filter((row) => (row.room_id && ids.has(row.room_id)) || row.requested_property_id === property.id);
    const sold = rows.reduce((sum, row) => sum + overlapNights(row, start, endExclusive), 0);
    const capacity = propertyRooms.length * days;
    return { property, bookings: rows.length, sold, capacity, rate: capacity ? Math.min(100, sold / capacity * 100) : 0 };
  });

  const sources = Array.from(scopedReservations.reduce((map, row) => {
    const key = sourceLabel(row.source);
    const current = map.get(key) ?? { count: 0, sales: 0 };
    current.count += 1;
    current.sales += reservationRevenue(row);
    map.set(key, current);
    return map;
  }, new Map<string, { count: number; sales: number }>()).entries()).sort((a, b) => b[1].sales - a[1].sales);

  return <main className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:py-8">
    <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
      <div><p className="text-sm font-medium text-blue-700">売上・精算</p><h1 className="mt-1 text-2xl font-semibold tracking-tight text-neutral-950">売上レポート・稼働率分析</h1><p className="mt-2 text-sm text-neutral-500">Stripe・楽天・電話・現地予約を販売経路別に確認できます。</p><a href={`/api/reports/csv?start=${format(start, "yyyy-MM-dd")}&end=${format(end, "yyyy-MM-dd")}`} className="mt-3 inline-flex min-h-11 items-center rounded-lg border border-neutral-300 bg-white px-4 text-sm font-semibold hover:bg-neutral-50">CSVを出力</a></div>
      <form className="grid gap-3 rounded-xl border border-neutral-200 bg-white p-4 shadow-sm sm:grid-cols-4" aria-label="レポート条件">
        <label className="text-xs font-medium text-neutral-600">開始日<input name="start" type="date" defaultValue={format(start, "yyyy-MM-dd")} className="mt-1 block min-h-11 w-full rounded-lg border border-neutral-300 px-3 text-sm" /></label>
        <label className="text-xs font-medium text-neutral-600">終了日<input name="end" type="date" defaultValue={format(end, "yyyy-MM-dd")} className="mt-1 block min-h-11 w-full rounded-lg border border-neutral-300 px-3 text-sm" /></label>
        <label className="text-xs font-medium text-neutral-600">施設<select name="property" defaultValue={selectedProperty} className="mt-1 block min-h-11 w-full rounded-lg border border-neutral-300 bg-white px-3 text-sm"><option value="all">全施設</option>{allProperties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        <button className="min-h-11 self-end rounded-lg bg-neutral-900 px-5 text-sm font-semibold text-white hover:bg-neutral-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-900">表示を更新</button>
      </form>
    </div>

    <section className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label="主要指標">
      <Metric label="売上合計" value={yen.format(totalSales)} hint={`${scopedReservations.length}件・全販売経路`} />
      <Metric label="ADR（平均客室単価）" value={yen.format(adr)} hint="売上 ÷ 利用室泊" />
      <Metric label="稼働率" value={`${occupancy.toFixed(1)}%`} hint={`${soldRoomNights} / ${availableRoomNights} 室泊`} />
      <Metric label="税金内訳" value={yen.format(taxTotal)} hint="備考に記録された宿泊税・消費税" />
    </section>

    <p className="mt-3 text-xs leading-5 text-neutral-500">Stripe以外の金額は予約詳細の「編集」から売上金額を入力できます。稼働率は期間内の利用室泊数 ÷ 販売可能室泊数、ADRは売上合計 ÷ 利用室泊数です。</p>

    <section className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(260px,1fr)]">
      <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm"><div className="border-b border-neutral-200 px-5 py-4"><h2 className="font-semibold text-neutral-950">施設別稼働率</h2></div><div className="overflow-x-auto"><table className="w-full min-w-[620px] text-left text-sm"><thead className="bg-neutral-50 text-xs text-neutral-500"><tr><th className="px-5 py-3 font-medium">施設</th><th className="px-4 py-3 text-right font-medium">予約数</th><th className="px-4 py-3 text-right font-medium">利用室泊</th><th className="px-5 py-3 font-medium">稼働率</th></tr></thead><tbody className="divide-y divide-neutral-100">{propertyRows.map(({ property, bookings, sold, capacity, rate }) => <tr key={property.id}><td className="px-5 py-4 font-medium">{property.name}</td><td className="px-4 py-4 text-right tabular-nums">{bookings}</td><td className="px-4 py-4 text-right tabular-nums">{sold} / {capacity}</td><td className="px-5 py-4"><div className="flex items-center gap-3"><div className="h-2 flex-1 overflow-hidden rounded-full bg-neutral-100"><div className="h-full rounded-full bg-blue-600" style={{ width: `${rate}%` }} /></div><span className="w-14 text-right font-medium tabular-nums">{rate.toFixed(1)}%</span></div></td></tr>)}</tbody></table></div></div>
      <div className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm"><h2 className="font-semibold text-neutral-950">販売経路別売上</h2><div className="mt-5 space-y-4">{sources.length ? sources.map(([source, values]) => <div key={source}><div className="flex justify-between gap-3 text-sm"><span>{source} <span className="text-xs text-neutral-500">{values.count}件</span></span><span className="font-semibold tabular-nums">{yen.format(values.sales)}</span></div><div className="mt-2 h-2 overflow-hidden rounded-full bg-neutral-100"><div className="h-full rounded-full bg-emerald-600" style={{ width: `${totalSales ? values.sales / totalSales * 100 : values.count / scopedReservations.length * 100}%` }} /></div></div>) : <p className="text-sm text-neutral-500">該当期間の予約はありません。</p>}</div></div>
    </section>
  </main>;
}

function Metric({ label, value, hint }: { label: string; value: string; hint: string }) {
  return <article className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm"><p className="text-sm font-medium text-neutral-500">{label}</p><p className="mt-3 text-2xl font-semibold tracking-tight text-neutral-950 tabular-nums">{value}</p><p className="mt-2 text-xs text-neutral-500">{hint}</p></article>;
}
