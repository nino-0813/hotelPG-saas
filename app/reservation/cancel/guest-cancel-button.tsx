"use client";
import { useState, useTransition } from "react";

export function GuestCancelButton({ token, initialCancelled }: { token: string; initialCancelled: boolean }) {
  const [cancelled, setCancelled] = useState(initialCancelled);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  if (cancelled) return <p className="mt-6 rounded-lg bg-emerald-50 p-4 font-medium text-emerald-800">この予約はキャンセル済みです。</p>;
  return <div className="mt-6"><button type="button" disabled={pending} onClick={() => { if (!confirm("予約をキャンセルします。よろしいですか？")) return; startTransition(async () => { setError(""); const response = await fetch("/api/public/reservations/cancel", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token }) }); const json = await response.json(); if (!response.ok) setError(json.error ?? "失敗しました"); else setCancelled(true); }); }} className="min-h-12 w-full rounded-lg bg-red-600 px-5 font-semibold text-white hover:bg-red-700 disabled:opacity-50">{pending ? "処理中..." : "予約をキャンセル"}</button>{error ? <p role="alert" className="mt-3 text-sm text-red-700">{error}</p> : null}</div>;
}
