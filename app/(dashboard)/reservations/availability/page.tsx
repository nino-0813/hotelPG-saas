import Link from "next/link";
import { addDays, addMonths, format, getDaysInMonth, isValid, parseISO, startOfMonth } from "date-fns";
import { ja } from "date-fns/locale";
import { redirect } from "next/navigation";
import { getCachedSupabaseAuth } from "@/lib/supabase/server";
import { computeRakutenInventoryByDate, countsTowardRakutenBlock, type RakutenInventoryGroup, type RakutenInventoryReservationRow } from "@/lib/availability/rakuten-inventory";
import { roomTypeLabel } from "@/lib/room-type-labels";
import type { Property, Room, RoomBlock, RoomType } from "@/lib/types/database";
import { ReservationViewTabs } from "../reservation-view-tabs";

type SearchParams = Promise<{ month?: string | string[] }>;

function resolveMonth(value: string | string[] | undefined) {
  const raw = typeof value === "string" ? value : "";
  const parsed = parseISO(`${raw}-01`);
  if (/^\d{4}-\d{2}$/.test(raw) && isValid(parsed) && format(parsed, "yyyy-MM") === raw) return startOfMonth(parsed);
  return startOfMonth(new Date());
}

export default async function ReservationAvailabilityPage({ searchParams }: { searchParams: SearchParams }) {
  const { supabase, user } = await getCachedSupabaseAuth();
  if (!user) redirect("/login");
  const { data: staff } = await supabase.from("staff").select("role").eq("id", user.id).maybeSingle();
  if (staff?.role !== "admin") redirect("/rooms");

  const params = await searchParams;
  const month = resolveMonth(params.month);
  const days = getDaysInMonth(month);
  const start = format(month, "yyyy-MM-dd");
  const endExclusive = format(addDays(month, days), "yyyy-MM-dd");

  const [{ data: properties }, { data: rooms }, { data: reservations }, { data: roomBlocks }] = await Promise.all([
    supabase.from("properties").select("*").order("display_order").returns<Property[]>(),
    supabase.from("rooms").select("*").order("display_order").returns<Room[]>(),
    supabase.from("reservations").select("room_id,requested_property_id,requested_room_type,check_in_date,check_out_date,status").neq("status", "cancelled").lt("check_in_date", endExclusive).gt("check_out_date", start).returns<RakutenInventoryReservationRow[]>(),
    supabase.from("room_blocks").select("room_id,start_date,end_date,is_active").eq("is_active", true).lt("start_date", endExclusive).gte("end_date", start).returns<RoomBlock[]>(),
  ]);

  const inventory = computeRakutenInventoryByDate(
    start,
    days,
    (rooms ?? []).map((room) => ({ id: room.id, property_id: room.property_id, room_type: room.room_type })),
    reservations ?? [],
    roomBlocks ?? [],
  );
  const propertyOrder = new Map((properties ?? []).map((property, index) => [property.id, index]));
  const groups = [...inventory.groups].sort((a, b) => (propertyOrder.get(a.propertyId) ?? 999) - (propertyOrder.get(b.propertyId) ?? 999) || a.roomType.localeCompare(b.roomType));
  const today = format(new Date(), "yyyy-MM-dd");
  const findBookableRoomId = (propertyId: string, roomType: string | undefined, date: string) => {
    const blockedRoomIds = new Set((roomBlocks ?? []).filter((block) => block.is_active && block.start_date <= date && block.end_date >= date).map((block) => block.room_id));
    const occupiedRoomIds = new Set((reservations ?? []).filter((reservation) => countsTowardRakutenBlock(reservation.status) && reservation.room_id && reservation.check_in_date <= date && date < reservation.check_out_date).map((reservation) => reservation.room_id as string));
    const candidates = (rooms ?? []).filter((room) => room.property_id === propertyId && (!roomType || room.room_type === roomType) && !blockedRoomIds.has(room.id) && !occupiedRoomIds.has(room.id));
    const unassignedCount = (reservations ?? []).filter((reservation) => countsTowardRakutenBlock(reservation.status) && !reservation.room_id && reservation.requested_property_id === propertyId && (!roomType || reservation.requested_room_type === roomType) && reservation.check_in_date <= date && date < reservation.check_out_date).length;
    return candidates[unassignedCount]?.id;
  };

  return <main className="min-w-0 max-w-full px-4 py-4 sm:px-6 sm:py-6">
    <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div><h1 className="text-xl font-semibold tracking-tight">残室表</h1><p className="mt-1 text-sm text-neutral-500">施設・部屋タイプごとの残室数を1か月分確認できます。</p></div>
      <MonthNav month={month} />
    </div>
    <ReservationViewTabs active="availability" />
    <div className="mb-3 flex flex-wrap items-center gap-3 text-xs text-neutral-600"><span className="font-medium">数字は残室数</span><Legend color="bg-emerald-100 text-emerald-900" label="2室以上" /><Legend color="bg-amber-100 text-amber-900" label="残り1室" /><Legend color="bg-red-100 text-red-900" label="満室" /><span>「残室 / 販売可能室数」で表示</span></div>
    <div className="max-h-[calc(100dvh-220px)] overflow-auto rounded-xl border border-neutral-200 bg-white shadow-sm">
      <table className="min-w-max border-separate border-spacing-0 text-center text-xs">
        <thead className="sticky top-0 z-20 bg-white shadow-sm"><tr><th className="sticky left-0 z-30 min-w-52 border-b border-r border-neutral-200 bg-neutral-50 px-4 py-3 text-left">施設・部屋タイプ</th>{inventory.dates.map((date) => { const parsed = parseISO(date); const weekend = parsed.getDay() === 0 || parsed.getDay() === 6; return <th key={date} className={`min-w-14 border-b border-r border-neutral-200 px-1 py-2 ${date === today ? "bg-blue-50 ring-2 ring-inset ring-blue-500" : "bg-neutral-50"}`}><span className={weekend ? parsed.getDay() === 0 ? "text-red-600" : "text-blue-600" : "text-neutral-900"}>{format(parsed, "d")}</span><span className="block text-[10px] font-normal text-neutral-500">{format(parsed, "E", { locale: ja })}</span></th>; })}</tr></thead>
        <tbody>{(properties ?? []).map((property) => { const propertyGroups = groups.filter((group) => group.propertyId === property.id); if (!propertyGroups.length) return null; return <PropertyRows key={property.id} property={property} groups={propertyGroups} dates={inventory.dates} today={today} findBookableRoomId={findBookableRoomId} />; })}</tbody>
      </table>
    </div>
  </main>;
}

function PropertyRows({ property, groups, dates, today, findBookableRoomId }: { property: Property; groups: RakutenInventoryGroup[]; dates: string[]; today: string; findBookableRoomId: (propertyId: string, roomType: string | undefined, date: string) => string | undefined }) {
  return <>
    <tr><th className="sticky left-0 z-10 border-b border-r border-neutral-200 bg-neutral-900 px-4 py-2 text-left font-semibold text-white">{property.name}<span className="ml-2 font-normal text-neutral-300">合計</span></th>{dates.map((date, index) => { const sellable = groups.reduce((sum, group) => sum + group.cells[index].sellable, 0); const total = groups.reduce((sum, group) => sum + group.cells[index].totalRooms, 0); const availableGroup = groups.find((group) => group.cells[index].sellable > 0); const roomId = availableGroup ? findBookableRoomId(property.id, availableGroup.roomType, date) : undefined; return <AvailabilityCell key={date} sellable={sellable} total={total} today={date === today} roomId={roomId} date={date} strong />; })}</tr>
    {groups.map((group) => <tr key={`${group.propertyId}-${group.roomType}`}><th className="sticky left-0 z-10 border-b border-r border-neutral-200 bg-white px-4 py-3 text-left font-medium text-neutral-800">{roomTypeLabel(group.roomType as RoomType)}<span className="ml-2 text-[10px] font-normal text-neutral-400">{group.totalRooms}室</span></th>{group.cells.map((cell) => <AvailabilityCell key={cell.date} sellable={cell.sellable} total={cell.totalRooms} today={cell.date === today} roomId={cell.sellable > 0 ? findBookableRoomId(group.propertyId, group.roomType, cell.date) : undefined} date={cell.date} />)}</tr>)}
  </>;
}

function AvailabilityCell({ sellable, total, today, roomId, date, strong = false }: { sellable: number; total: number; today: boolean; roomId?: string; date: string; strong?: boolean }) {
  const color = sellable === 0 ? "bg-red-50 text-red-800" : sellable === 1 ? "bg-amber-50 text-amber-900" : "bg-emerald-50 text-emerald-900";
  const content = <><span className={strong ? "text-base font-bold" : "text-sm font-bold"}>{sellable}</span><span className="block text-[9px] font-normal opacity-60">/{total}</span></>;
  return <td title={roomId ? `残室 ${sellable} / 販売可能 ${total}・クリックして新規予約` : `残室 ${sellable} / 販売可能 ${total}`} className={`border-b border-r border-neutral-200 p-0 ${color} ${today ? "ring-2 ring-inset ring-blue-500" : ""}`}>{roomId ? <Link href={{ pathname: "/reservations/new", query: { date, room: roomId } }} className="block min-h-11 px-1 py-1 transition hover:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-blue-600" aria-label={`${date}の空室で新規予約を作成`}>{content}</Link> : <div className="min-h-11 px-1 py-1">{content}</div>}</td>;
}

function MonthNav({ month }: { month: Date }) {
  const prev = format(addMonths(month, -1), "yyyy-MM");
  const next = format(addMonths(month, 1), "yyyy-MM");
  const current = format(new Date(), "yyyy-MM");
  const button = "inline-flex min-h-10 items-center rounded-lg border border-neutral-300 bg-white px-3 text-sm font-medium hover:bg-neutral-50";
  return <div className="flex flex-wrap items-center gap-2"><Link className={button} href={`?month=${prev}`}>← 前月</Link><span className="min-w-28 text-center text-lg font-semibold tabular-nums">{format(month, "yyyy年M月")}</span><Link className={button} href={`?month=${next}`}>翌月 →</Link><Link className={button} href={`?month=${current}`}>今月</Link></div>;
}

function Legend({ color, label }: { color: string; label: string }) {
  return <span className="inline-flex items-center gap-1"><span className={`h-3 w-3 rounded-sm ${color}`} />{label}</span>;
}
