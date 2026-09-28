"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { RefundReservation, RefundSettings } from "./page";
import {
  executeStripeRefund,
  getRefundPreview,
  saveRefundSettings,
  type RefundPolicy,
} from "./actions";

type Preview = Awaited<ReturnType<typeof getRefundPreview>>;

const yen = (value: number) => `${Math.max(0, Math.round(value)).toLocaleString("ja-JP")}円`;

function daysUntil(date: string) {
  const [year, month, day] = date.split("-").map(Number);
  const now = new Date();
  const todayUtc = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.ceil((Date.UTC(year, month - 1, day) - todayUtc) / 86_400_000);
}

export function RefundManager({ settings, reservations, loadError }: { settings: RefundSettings; reservations: RefundReservation[]; loadError: string | null }) {
  const router = useRouter();
  const [selected, setSelected] = useState<RefundReservation | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [policy, setPolicy] = useState<RefundPolicy>("full");
  const [customAmount, setCustomAmount] = useState(0);
  const [error, setError] = useState("");
  const [result, setResult] = useState("");
  const [loading, startLoading] = useTransition();
  const [refunding, startRefunding] = useTransition();

  const openRefund = (reservation: RefundReservation) => {
    setSelected(reservation);
    setPreview(null);
    setError("");
    setResult("");
    startLoading(async () => {
      try {
        const next = await getRefundPreview(reservation.id);
        setPreview(next);
        const lastMinute = daysUntil(next.checkInDate) <= settings.last_minute_days;
        const nextPolicy: RefundPolicy = lastMinute && settings.last_minute_fee_value > 0
          ? "last_minute"
          : settings.normal_policy;
        setPolicy(nextPolicy);
        setCustomAmount(next.originalAmount);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "決済情報を取得できませんでした");
      }
    });
  };

  const calculation = useMemo(() => {
    if (!preview) return { deduction: 0, refund: 0 };
    let deduction = 0;
    if (policy === "deduct_processing_fee") {
      deduction = preview.processingFeeAmount ?? Math.round(preview.originalAmount * settings.processing_fee_rate / 100);
    } else if (policy === "last_minute") {
      deduction = settings.last_minute_fee_type === "percentage"
        ? Math.round(preview.originalAmount * settings.last_minute_fee_value / 100)
        : settings.last_minute_fee_value;
    } else if (policy === "custom") {
      return { deduction: Math.max(0, preview.originalAmount - customAmount), refund: Math.min(preview.originalAmount, Math.max(0, customAmount)) };
    }
    deduction = Math.min(preview.originalAmount, Math.max(0, deduction));
    return { deduction, refund: preview.originalAmount - deduction };
  }, [customAmount, policy, preview, settings]);

  const runRefund = () => {
    if (!selected || !preview || calculation.refund <= 0) return;
    startRefunding(async () => {
      setError("");
      try {
        const response = await executeStripeRefund({ reservationId: selected.id, amountJpy: calculation.refund, policy });
        setResult(`Stripe返金を受け付けました（${response.stripeRefundId} / ${response.status}）`);
        router.refresh();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "返金処理に失敗しました");
      }
    });
  };

  return <main className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:py-8">
    <div><p className="text-sm font-medium text-blue-700">売上・精算</p><h1 className="mt-1 text-2xl font-semibold tracking-tight text-neutral-950">Stripe返金管理</h1><p className="mt-2 max-w-3xl text-sm leading-6 text-neutral-500">キャンセル済みの公式サイト予約を確認し、返金額を決めてStripeへ返金します。返金実行後は取り消せません。</p></div>

    {loadError ? <p role="alert" className="mt-5 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">返金管理用テーブルを読み込めません。Supabaseへ最新のマイグレーションを適用してください。<span className="mt-1 block text-xs">{loadError}</span></p> : null}

    <section className="mt-7 rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
      <div><h2 className="font-semibold text-neutral-950">返金ルール設定</h2><p className="mt-1 text-sm text-neutral-500">各返金の確認画面で変更できますが、最初に選ばれる標準ルールを設定します。</p></div>
      <form action={saveRefundSettings} className="mt-5 grid gap-4 lg:grid-cols-5">
        <label className="text-xs font-medium text-neutral-600">通常キャンセル<select name="normal_policy" defaultValue={settings.normal_policy} className="mt-1 min-h-11 w-full rounded-lg border border-neutral-300 bg-white px-3 text-sm"><option value="full">全額返金</option><option value="deduct_processing_fee">決済手数料相当額を控除</option></select></label>
        <label className="text-xs font-medium text-neutral-600">決済手数料率<input name="processing_fee_rate" type="number" min="0" max="100" step="0.001" defaultValue={settings.processing_fee_rate} className="mt-1 min-h-11 w-full rounded-lg border border-neutral-300 px-3 text-sm tabular-nums" /><span className="mt-1 block text-[11px] text-neutral-500">％</span></label>
        <label className="text-xs font-medium text-neutral-600">直前扱いの日数<input name="last_minute_days" type="number" min="0" max="365" defaultValue={settings.last_minute_days} className="mt-1 min-h-11 w-full rounded-lg border border-neutral-300 px-3 text-sm tabular-nums" /><span className="mt-1 block text-[11px] text-neutral-500">宿泊日の何日前から</span></label>
        <label className="text-xs font-medium text-neutral-600">直前キャンセル料<select name="last_minute_fee_type" defaultValue={settings.last_minute_fee_type} className="mt-1 min-h-11 w-full rounded-lg border border-neutral-300 bg-white px-3 text-sm"><option value="percentage">決済額の割合</option><option value="fixed">固定額</option></select></label>
        <div className="flex gap-3"><label className="flex-1 text-xs font-medium text-neutral-600">料率・金額<input name="last_minute_fee_value" type="number" min="0" defaultValue={settings.last_minute_fee_value} className="mt-1 min-h-11 w-full rounded-lg border border-neutral-300 px-3 text-sm tabular-nums" /></label><button className="mt-5 min-h-11 rounded-lg bg-neutral-900 px-5 text-sm font-semibold text-white hover:bg-neutral-700">保存</button></div>
      </form>
    </section>

    <section className="mt-7 overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm">
      <div className="border-b border-neutral-200 px-5 py-4"><h2 className="font-semibold text-neutral-950">返金対象のキャンセル予約</h2><p className="mt-1 text-xs text-neutral-500">Stripe決済かつキャンセル済みの予約を新しい順に表示します。</p></div>
      {reservations.length ? <div className="divide-y divide-neutral-100">{reservations.map((reservation) => {
        const transaction = reservation.refund_transactions?.[0];
        const completed = transaction?.status === "succeeded";
        return <div key={reservation.id} className="grid gap-4 px-5 py-4 md:grid-cols-[1.2fr_1fr_1fr_auto] md:items-center">
          <div><p className="font-medium text-neutral-950">{reservation.guest_name} 様</p><p className="mt-1 text-xs text-neutral-500">{reservation.guest_email ?? "メールなし"}</p></div>
          <div className="text-sm"><p>{reservation.rooms?.properties?.name ?? "施設不明"} / {reservation.rooms?.room_number ?? "未割当"}</p><p className="mt-1 text-xs text-neutral-500">{reservation.check_in_date} 〜 {reservation.check_out_date}</p></div>
          <div>{transaction ? <><span className={completed ? "rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700" : "rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-800"}>{completed ? "返金済み" : transaction.status}</span><p className="mt-2 text-xs text-neutral-500">返金 {yen(transaction.refund_amount)} / 控除 {yen(transaction.deducted_amount)}</p></> : <span className="rounded-full bg-neutral-100 px-2.5 py-1 text-xs font-medium text-neutral-600">未返金</span>}</div>
          <button type="button" onClick={() => openRefund(reservation)} disabled={completed || loading} className="min-h-11 rounded-lg border border-neutral-300 bg-white px-4 text-sm font-semibold hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50">{completed ? "返金済み" : "返金内容を確認"}</button>
        </div>;
      })}</div> : <p className="px-5 py-12 text-center text-sm text-neutral-500">返金対象の予約はありません。</p>}
    </section>

    {selected ? <div role="dialog" aria-modal="true" aria-labelledby="refund-dialog-title" className="fixed inset-0 z-[80] flex items-end justify-center bg-black/50 sm:items-center sm:p-4"><div className="max-h-[94dvh] w-full overflow-auto rounded-t-2xl bg-white shadow-2xl sm:max-w-xl sm:rounded-2xl">
      <div className="border-b border-neutral-200 px-5 py-4"><h2 id="refund-dialog-title" className="text-lg font-semibold">返金内容の確認</h2><p className="mt-1 text-sm text-neutral-500">{selected.guest_name} 様 / {selected.check_in_date}から</p></div>
      <div className="space-y-5 px-5 py-5">{loading ? <p role="status" className="py-8 text-center text-sm text-neutral-500">Stripeの決済情報を確認しています...</p> : preview ? <>
        <div className="grid grid-cols-2 gap-3 rounded-xl bg-neutral-50 p-4 text-sm"><span className="text-neutral-500">お客様の決済額</span><strong className="text-right tabular-nums">{yen(preview.originalAmount)}</strong><span className="text-neutral-500">差し引く金額</span><strong className="text-right tabular-nums text-red-700">− {yen(calculation.deduction)}</strong><span className="border-t border-neutral-200 pt-3 font-medium">最終返金額</span><strong className="border-t border-neutral-200 pt-3 text-right text-lg tabular-nums text-emerald-700">{yen(calculation.refund)}</strong></div>
        <fieldset><legend className="text-sm font-semibold">返金方法</legend><div className="mt-2 space-y-2">{([
          ["full", "全額返金", "通常キャンセル向け"],
          ["deduct_processing_fee", "決済手数料相当額を差し引く", preview.processingFeeAmount != null ? `決済時記録：${yen(preview.processingFeeAmount)}` : `設定率：${settings.processing_fee_rate}%`],
          ["last_minute", "直前キャンセル料を差し引く", `${settings.last_minute_days}日前から・${settings.last_minute_fee_type === "percentage" ? `${settings.last_minute_fee_value}%` : yen(settings.last_minute_fee_value)}`],
          ["custom", "返金額を直接入力", "個別対応"],
        ] as const).map(([value, label, note]) => <label key={value} className="flex min-h-12 cursor-pointer items-start gap-3 rounded-lg border border-neutral-200 p-3 hover:bg-neutral-50"><input type="radio" name="refund_policy" value={value} checked={policy === value} onChange={() => setPolicy(value)} className="mt-1 h-4 w-4 accent-blue-600" /><span><span className="block text-sm font-medium">{label}</span><span className="block text-xs text-neutral-500">{note}</span></span></label>)}</div></fieldset>
        {policy === "custom" ? <label className="block text-sm font-medium">返金額<input type="number" min="1" max={preview.originalAmount} value={customAmount} onChange={(event) => setCustomAmount(Number(event.target.value))} className="mt-1 min-h-11 w-full rounded-lg border border-neutral-300 px-3 tabular-nums" /></label> : null}
        <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm leading-6 text-red-800"><strong>重要：</strong>返金実行後は取り消せません。表示金額を確認してから実行してください。</p>
      </> : null}{error ? <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}{result ? <p role="status" className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{result}</p> : null}</div>
      <div className="flex flex-col-reverse gap-2 border-t border-neutral-200 bg-neutral-50 px-5 py-4 sm:flex-row sm:justify-end"><button type="button" onClick={() => setSelected(null)} disabled={refunding} className="min-h-11 rounded-lg border border-neutral-300 bg-white px-5 text-sm font-semibold hover:bg-neutral-50 disabled:opacity-50">閉じる</button><button type="button" onClick={runRefund} disabled={refunding || !preview || calculation.refund <= 0 || Boolean(result)} className="min-h-11 rounded-lg bg-red-600 px-5 text-sm font-semibold text-white hover:bg-red-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-600 disabled:cursor-not-allowed disabled:opacity-50">{refunding ? "Stripeへ返金中..." : `${yen(calculation.refund)}を返金する`}</button></div>
    </div></div> : null}
  </main>;
}
