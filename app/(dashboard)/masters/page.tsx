import Link from "next/link";
import { redirect } from "next/navigation";
import { getCachedSupabaseAuth } from "@/lib/supabase/server";
import type { Reservation } from "@/lib/types/database";
import { extractPlan, sourceLabel } from "@/lib/revenue";

export default async function MastersPage() {
  const { supabase, user } = await getCachedSupabaseAuth();
  if (!user) redirect("/login");
  const { data: staff } = await supabase.from("staff").select("role").eq("id", user.id).maybeSingle();
  if (staff?.role !== "admin") redirect("/rooms");
  const { data } = await supabase.from("reservations").select("source,special_notes,status").neq("status", "blocked").returns<Pick<Reservation, "source" | "special_notes" | "status">[]>();
  const reservations = data ?? [];
  const channelMap = new Map<string, number>();
  const planMap = new Map<string, number>();
  for (const row of reservations) {
    const channel = sourceLabel(row.source);
    channelMap.set(channel, (channelMap.get(channel) ?? 0) + 1);
    const plan = extractPlan(row.special_notes);
    planMap.set(plan, (planMap.get(plan) ?? 0) + 1);
  }
  const standardChannels = ["楽天", "公式サイト", "電話", "現地予約", "手入力・その他"];
  return <main className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6"><div><p className="text-sm font-medium text-violet-700">統一マスタ</p><h1 className="mt-1 text-2xl font-semibold">プラン・販売経路</h1><p className="mt-1 text-sm text-neutral-500">予約データの表記を統一し、経路別集計に利用します。</p></div>
    <div className="mt-6 grid gap-6 lg:grid-cols-2"><section className="rounded-xl border bg-white shadow-sm"><header className="border-b p-5"><h2 className="font-semibold">販売経路マスタ</h2><p className="mt-1 text-xs text-neutral-500">楽天・公式サイト・電話・現地予約を共通分類に変換</p></header><div className="divide-y">{standardChannels.map((name) => <div key={name} className="flex items-center justify-between p-4"><div><p className="font-medium">{name}</p><p className="text-xs text-neutral-500">{channelDescription(name)}</p></div><span className="rounded-full bg-neutral-100 px-3 py-1 text-sm font-semibold tabular-nums">{channelMap.get(name) ?? 0}件</span></div>)}</div></section>
    <section className="rounded-xl border bg-white shadow-sm"><header className="flex items-center justify-between border-b p-5"><div><h2 className="font-semibold">宿泊プラン</h2><p className="mt-1 text-xs text-neutral-500">予約備考から利用中のプランを自動抽出</p></div><Link href="/pricing" className="rounded-lg border px-3 py-2 text-sm font-medium hover:bg-neutral-50">料金設定へ</Link></header><div className="max-h-[520px] divide-y overflow-auto">{[...planMap.entries()].sort((a,b) => b[1]-a[1]).map(([name,count]) => <div key={name} className="flex items-start justify-between gap-3 p-4"><p className="text-sm font-medium leading-6">{name}</p><span className="shrink-0 rounded-full bg-neutral-100 px-3 py-1 text-xs font-semibold">{count}件</span></div>)}</div></section></div>
    <aside className="mt-6 rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-950"><strong>入力ルール：</strong>予約編集画面の「予約元」は <code>rakuten_oyado</code>、<code>stripe_web</code>、<code>phone</code>、<code>onsite</code>、<code>manual</code> のいずれかを使用すると、集計が統一されます。</aside>
  </main>;
}

function channelDescription(name: string) {
  if (name === "楽天") return "楽天お宿・Vacation STAYから取り込んだ予約";
  if (name === "公式サイト") return "公式予約画面・Stripe決済";
  if (name === "電話") return "電話で受け付けた直接予約";
  if (name === "現地予約") return "フロント・現地で受け付けた予約";
  return "手入力または分類されていない予約";
}
