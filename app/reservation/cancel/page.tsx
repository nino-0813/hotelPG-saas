import { createServiceRoleSupabase } from "@/lib/supabase/service-role";
import { GuestCancelButton } from "./guest-cancel-button";

export default async function GuestCancelPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const token = (await searchParams).token ?? "";
  const valid = /^[0-9a-f-]{36}$/i.test(token);
  const db = createServiceRoleSupabase();
  const [{ data }, { data: settings }] = await Promise.all([
    valid ? db.from("reservations").select("guest_name,check_in_date,check_out_date,status").eq("guest_cancellation_token", token).maybeSingle() : Promise.resolve({ data: null }),
    db.from("refund_settings").select("normal_policy,processing_fee_rate,last_minute_days,last_minute_fee_type,last_minute_fee_value").eq("id", true).maybeSingle(),
  ]);
  const now = new Date();
  const checkIn = data ? new Date(`${data.check_in_date}T00:00:00+09:00`) : null;
  const daysUntilCheckIn = checkIn ? Math.ceil((checkIn.getTime() - now.getTime()) / 86_400_000) : Number.POSITIVE_INFINITY;
  const refundNotice = {
    normalPolicy: settings?.normal_policy === "deduct_processing_fee" ? "deduct_processing_fee" as const : "full" as const,
    processingFeeRate: Number(settings?.processing_fee_rate ?? 3.96),
    isLastMinute: Number(settings?.last_minute_fee_value ?? 0) > 0 && daysUntilCheckIn <= Number(settings?.last_minute_days ?? 3),
    lastMinuteFeeType: settings?.last_minute_fee_type === "fixed" ? "fixed" as const : "percentage" as const,
    lastMinuteFeeValue: Number(settings?.last_minute_fee_value ?? 0),
  };
  return <main className="mx-auto flex min-h-dvh max-w-2xl items-center px-4 py-10"><section className="w-full rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm sm:p-8"><h1 className="text-2xl font-semibold">予約キャンセル</h1>{data ? <><dl className="mt-6 grid grid-cols-[110px_1fr] gap-y-3 text-sm"><dt className="text-neutral-500">お名前</dt><dd>{data.guest_name} 様</dd><dt className="text-neutral-500">チェックイン</dt><dd>{data.check_in_date}</dd><dt className="text-neutral-500">チェックアウト</dt><dd>{data.check_out_date}</dd></dl><GuestCancelButton token={token} initialCancelled={data.status === "cancelled"} refundNotice={refundNotice} /></> : <p className="mt-5 text-sm text-red-700">無効なURL、または予約が見つかりません。</p>}</section></main>;
}
