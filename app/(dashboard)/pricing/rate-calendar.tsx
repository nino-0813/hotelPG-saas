import { addMonths, eachDayOfInterval, endOfMonth, format, getDay, isValid, parse, startOfMonth } from "date-fns";
import { ja } from "date-fns/locale";
import Link from "next/link";
import type { PublicRoomSettingRow, PublicSeasonalRoomRateRow } from "@/lib/types/public-catalog";

function resolveMonth(value?: string) {
  const parsed = parse(value ?? "", "yyyy-MM", new Date());
  return /^\d{4}-\d{2}$/.test(value ?? "") && isValid(parsed) ? startOfMonth(parsed) : startOfMonth(new Date());
}

function priceForDay(row: Pick<PublicRoomSettingRow, "weekday_price" | "friday_price" | "saturday_price">, day: Date) {
  if (getDay(day) === 5) return row.friday_price;
  if (getDay(day) === 6) return row.saturday_price;
  return row.weekday_price;
}

export function RateCalendar({ month, settings, rates }: { month?: string; settings: PublicRoomSettingRow[]; rates: PublicSeasonalRoomRateRow[] }) {
  const monthDate = resolveMonth(month);
  const days = eachDayOfInterval({ start: monthDate, end: endOfMonth(monthDate) });
  const previous = format(addMonths(monthDate, -1), "yyyy-MM");
  const next = format(addMonths(monthDate, 1), "yyyy-MM");

  return <section id="rate-calendar" className="mt-10 scroll-mt-6">
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div><h2 className="text-lg font-semibold">月間料金カレンダー</h2><p className="mt-1 text-sm text-neutral-500">色付きの日は基本料金と異なる期間限定料金です。</p></div>
      <div className="flex items-center gap-2">
        <Link href={`/pricing?month=${previous}#rate-calendar`} className="min-h-11 rounded-lg border border-neutral-300 px-4 py-2.5 text-sm font-medium hover:bg-neutral-50">← 前月</Link>
        <span className="min-w-28 text-center text-sm font-semibold">{format(monthDate, "yyyy年M月", { locale: ja })}</span>
        <Link href={`/pricing?month=${next}#rate-calendar`} className="min-h-11 rounded-lg border border-neutral-300 px-4 py-2.5 text-sm font-medium hover:bg-neutral-50">翌月 →</Link>
      </div>
    </div>
    <div className="mt-4 overflow-x-auto rounded-xl border border-neutral-200 bg-white shadow-sm">
      <table className="min-w-max border-collapse text-xs">
        <thead><tr className="bg-neutral-50"><th className="sticky left-0 z-20 min-w-52 border-b border-r border-neutral-200 bg-neutral-50 px-4 py-3 text-left">施設・部屋タイプ</th>{days.map((day) => <th key={day.toISOString()} className={`min-w-20 border-b border-r border-neutral-200 px-2 py-2 text-center ${getDay(day) === 0 ? "text-red-600" : getDay(day) === 6 ? "text-blue-600" : "text-neutral-600"}`}><span className="block text-sm">{format(day, "d")}</span><span>{format(day, "E", { locale: ja })}</span></th>)}</tr></thead>
        <tbody>{settings.map((setting) => <tr key={setting.id}><th className="sticky left-0 z-10 border-b border-r border-neutral-200 bg-white px-4 py-3 text-left"><span className="block font-semibold text-neutral-900">{setting.display_name}</span><span className="mt-0.5 block font-normal text-neutral-400">{setting.property_code} / {setting.room_type}</span></th>{days.map((day) => {
          const date = format(day, "yyyy-MM-dd");
          const matching = rates.filter((rate) => rate.is_active && rate.property_code === setting.property_code && rate.room_type === setting.room_type && rate.start_date <= date && rate.end_date >= date).sort((a, b) => b.priority - a.priority)[0];
          const standard = priceForDay(setting, day);
          const price = matching ? priceForDay(matching, day) : standard;
          const changed = Boolean(matching && price !== standard);
          return <td key={`${setting.id}-${date}`} title={matching ? `${matching.name}（基本 ${standard.toLocaleString("ja-JP")}円）` : "基本料金"} className={`border-b border-r border-neutral-200 px-2 py-3 text-center tabular-nums ${changed ? "bg-amber-100 font-bold text-amber-900" : matching ? "bg-blue-50 font-semibold text-blue-900" : "text-neutral-700"}`}><span className="block">{price.toLocaleString("ja-JP")}</span>{changed ? <span className="mt-1 block text-[10px] font-medium">変更</span> : null}</td>;
        })}</tr>)}</tbody>
      </table>
    </div>
    <div className="mt-3 flex flex-wrap gap-4 text-xs text-neutral-600"><span><i className="mr-1 inline-block h-3 w-3 rounded-sm bg-amber-100 align-middle" />基本料金から変更</span><span><i className="mr-1 inline-block h-3 w-3 rounded-sm bg-blue-50 align-middle" />期間限定設定（基本料金と同額）</span><span>金額は1泊・基本人数の税込料金</span></div>
  </section>;
}
