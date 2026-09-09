import { redirect } from "next/navigation";
import { createServiceRoleSupabase } from "@/lib/supabase/service-role";
import { getCachedSupabaseAuth } from "@/lib/supabase/server";
import type { PublicRoomSettingRow, PublicSeasonalRoomRateRow } from "@/lib/types/public-catalog";
import { deleteSeasonalRate, saveSeasonalRate, updateBaseRate } from "./actions";

type SearchParams = Promise<{ saved?: string }>;
const input = "min-h-11 w-full rounded-lg border border-neutral-300 bg-white px-3 text-sm tabular-nums focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-100";

export default async function PricingPage({ searchParams }: { searchParams: SearchParams }) {
  const { supabase, user } = await getCachedSupabaseAuth();
  if (!user) redirect("/login");
  const { data: staff } = await supabase.from("staff").select("role").eq("id", user.id).maybeSingle();
  if (staff?.role !== "admin") redirect("/rooms");
  const db = createServiceRoleSupabase();
  const [{ data: settings }, { data: seasons }, params] = await Promise.all([
    db.from("public_room_settings").select("*").order("property_code").order("room_type").returns<PublicRoomSettingRow[]>(),
    db.from("public_seasonal_room_rates").select("*").order("start_date", { ascending: false }).returns<PublicSeasonalRoomRateRow[]>(),
    searchParams,
  ]);
  const roomSettings = settings ?? [];
  const seasonalRates = seasons ?? [];

  return <main className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:py-8">
    <div><p className="text-sm font-medium text-blue-700">管理者設定</p><h1 className="mt-1 text-2xl font-semibold tracking-tight text-neutral-950">動的料金管理</h1><p className="mt-2 max-w-3xl text-sm leading-6 text-neutral-500">基本料金と期間限定料金を管理します。保存した料金は公式サイトの空室検索とStripe決済額の計算に反映されます。</p></div>
    {params.saved ? <p role="status" className="mt-5 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">料金設定を保存しました。</p> : null}

    <section className="mt-7"><div className="mb-4"><h2 className="text-lg font-semibold">基本料金</h2><p className="mt-1 text-sm text-neutral-500">通常期間の曜日別料金と人数設定です。</p></div><div className="grid gap-5 xl:grid-cols-2">{roomSettings.map((row) => <form action={updateBaseRate} key={row.id} className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm"><input type="hidden" name="property_code" value={row.property_code} /><input type="hidden" name="room_type" value={row.room_type} /><div className="flex items-start justify-between gap-3"><div><p className="font-semibold text-neutral-950">{row.display_name}</p><p className="mt-1 text-xs text-neutral-500">{row.property_code} / {row.room_type}</p></div><label className="flex min-h-11 items-center gap-2 text-sm"><input name="is_active" type="checkbox" defaultChecked={row.is_active} className="h-4 w-4 accent-blue-600" />公開</label></div><div className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-3"><Field label="平日" name="weekday_price" value={row.weekday_price} suffix="円" /><Field label="金曜日" name="friday_price" value={row.friday_price} suffix="円" /><Field label="土曜日" name="saturday_price" value={row.saturday_price} suffix="円" /><Field label="基本人数" name="included_guests" value={row.included_guests} suffix="名" min={1} /><Field label="追加人数料金" name="extra_guest_fee" value={row.extra_guest_fee} suffix="円" /><Field label="最大人数" name="max_guests" value={row.max_guests} suffix="名" min={1} /><Field label="公式サイト在庫上限" name="inventory_cap" value={row.inventory_cap} suffix="室" /></div><div className="mt-5 flex justify-end"><button className="min-h-11 rounded-lg bg-neutral-900 px-5 text-sm font-semibold text-white hover:bg-neutral-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-900">基本料金を保存</button></div></form>)}</div></section>

    <section className="mt-10"><div className="mb-4"><h2 className="text-lg font-semibold">期間限定料金</h2><p className="mt-1 text-sm text-neutral-500">繁忙期やイベント期間に、基本料金より優先して適用します。</p></div><SeasonalForm settings={roomSettings} />
      <div className="mt-5 space-y-4">{seasonalRates.map((row) => <SeasonalForm key={row.id} settings={roomSettings} row={row} />)}{seasonalRates.length === 0 ? <div className="rounded-xl border border-dashed border-neutral-300 px-5 py-10 text-center text-sm text-neutral-500">期間限定料金はまだ登録されていません。</div> : null}</div></section>
  </main>;
}

function Field({ label, name, value, suffix, min = 0 }: { label: string; name: string; value: number; suffix: string; min?: number }) { return <label className="text-xs font-medium text-neutral-600">{label}<span className="relative mt-1 block"><input required min={min} name={name} type="number" defaultValue={value} className={`${input} pr-9`} /><span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-neutral-400">{suffix}</span></span></label>; }

function SeasonalForm({ settings, row }: { settings: PublicRoomSettingRow[]; row?: PublicSeasonalRoomRateRow }) {
  const fallback = settings[0];
  return <form action={saveSeasonalRate} className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm"><input type="hidden" name="id" value={row?.id ?? ""} /><div className="flex flex-col gap-5"><div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start"><div><h3 className="font-semibold">{row ? row.name : "新しい期間限定料金"}</h3><p className="mt-1 text-xs text-neutral-500">{row ? "登録済みの料金を編集できます。" : "対象と期間、曜日別料金を入力してください。"}</p></div><label className="flex min-h-11 items-center gap-2 text-sm"><input name="is_active" type="checkbox" defaultChecked={row?.is_active ?? true} className="h-4 w-4 accent-blue-600" />有効</label></div><div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"><label className="text-xs font-medium text-neutral-600">設定名<input required maxLength={200} name="name" defaultValue={row?.name ?? ""} className={`mt-1 ${input}`} placeholder="例：お盆特別料金" /></label><label className="text-xs font-medium text-neutral-600">対象の部屋<select name="target" defaultValue={row ? `${row.property_code}|${row.room_type}` : fallback ? `${fallback.property_code}|${fallback.room_type}` : ""} className={`mt-1 ${input}`}>{settings.map((s) => <option key={s.id} value={`${s.property_code}|${s.room_type}`}>{s.display_name}</option>)}</select></label><label className="text-xs font-medium text-neutral-600">開始日<input required name="start_date" type="date" defaultValue={row?.start_date ?? ""} className={`mt-1 ${input}`} /></label><label className="text-xs font-medium text-neutral-600">終了日<input required name="end_date" type="date" defaultValue={row?.end_date ?? ""} className={`mt-1 ${input}`} /></label></div><div className="grid grid-cols-2 gap-4 sm:grid-cols-4"><Field label="平日" name="weekday_price" value={row?.weekday_price ?? 0} suffix="円" /><Field label="金曜日" name="friday_price" value={row?.friday_price ?? 0} suffix="円" /><Field label="土曜日" name="saturday_price" value={row?.saturday_price ?? 0} suffix="円" /><Field label="優先度" name="priority" value={row?.priority ?? 100} suffix="" /></div><div className="flex flex-wrap justify-end gap-3">{row ? <button formAction={deleteSeasonalRate} className="min-h-11 rounded-lg border border-red-300 px-5 text-sm font-semibold text-red-700 hover:bg-red-50">削除</button> : null}<button className="min-h-11 rounded-lg bg-neutral-900 px-5 text-sm font-semibold text-white hover:bg-neutral-700">{row ? "変更を保存" : "期間限定料金を追加"}</button></div></div></form>;
}
