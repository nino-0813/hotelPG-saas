"use client";
import { useState, useTransition } from "react";
import { CancellationNotice } from "./cancellation-notice";

type RefundNoticeSettings = {
  normalPolicy: "full" | "deduct_processing_fee";
  processingFeeRate: number;
  isLastMinute: boolean;
  lastMinuteFeeType: "percentage" | "fixed";
  lastMinuteFeeValue: number;
};

export function GuestCancelButton({ token, initialCancelled, refundNotice }: { token: string; initialCancelled: boolean; refundNotice: RefundNoticeSettings }) {
  const [cancelled, setCancelled] = useState(initialCancelled);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  if (cancelled) return <p className="mt-6 rounded-lg bg-emerald-50 p-4 font-medium text-emerald-800">この予約はキャンセル済みです。</p>;
  return <div className="mt-6"><CancellationNotice normalPolicy={refundNotice.normalPolicy} processingFeeRate={refundNotice.processingFeeRate} isLastMinute={refundNotice.isLastMinute} lastMinuteFeeType={refundNotice.lastMinuteFeeType} lastMinuteFeeValue={refundNotice.lastMinuteFeeValue} /><button type="button" disabled={pending} onClick={() => { startTransition(async () => { setError(""); const response = await fetch("/api/public/reservations/cancel", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token }) }); const json = await response.json(); if (!response.ok) setError(json.error ?? "失敗しました"); else setCancelled(true); }); }} className="mt-4 min-h-12 w-full rounded-lg bg-red-600 px-5 font-semibold text-white transition-colors hover:bg-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50">{pending ? "キャンセル処理中..." : "上記の内容に同意してキャンセルする"}</button>{error ? <p role="alert" className="mt-3 text-sm text-red-700">{error}</p> : null}</div>;
}
