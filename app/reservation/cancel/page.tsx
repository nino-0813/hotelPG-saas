import { createServiceRoleSupabase } from "@/lib/supabase/service-role";
import { GuestCancelButton } from "./guest-cancel-button";

export default async function GuestCancelPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const token = (await searchParams).token ?? "";
  const valid = /^[0-9a-f-]{36}$/i.test(token);
  const { data } = valid ? await createServiceRoleSupabase().from("reservations").select("guest_name,check_in_date,check_out_date,status").eq("guest_cancellation_token", token).maybeSingle() : { data: null };
  return <main className="mx-auto flex min-h-dvh max-w-lg items-center px-4 py-10"><section className="w-full rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm"><h1 className="text-2xl font-semibold">予約キャンセル</h1>{data ? <><dl className="mt-6 grid grid-cols-[110px_1fr] gap-y-3 text-sm"><dt className="text-neutral-500">お名前</dt><dd>{data.guest_name} 様</dd><dt className="text-neutral-500">チェックイン</dt><dd>{data.check_in_date}</dd><dt className="text-neutral-500">チェックアウト</dt><dd>{data.check_out_date}</dd></dl><p className="mt-6 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">キャンセル料や返金の有無は予約条件によります。返金は自動実行されません。</p><GuestCancelButton token={token} initialCancelled={data.status === "cancelled"} /></> : <p className="mt-5 text-sm text-red-700">無効なURL、または予約が見つかりません。</p>}</section></main>;
}
