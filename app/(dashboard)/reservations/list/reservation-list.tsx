"use client";

import { useState } from "react";
import { differenceInCalendarDays, format, parseISO } from "date-fns";
import { ja } from "date-fns/locale";
import clsx from "clsx";
import type { Property, Reservation, ReservationStatus, Room } from "@/lib/types/database";
import { ReservationModal, type ModalState } from "../reservation-modal";

const STATUS: Record<ReservationStatus, { label: string; style: string }> = {
  confirmed: { label: "未到着", style: "bg-amber-50 text-amber-800 ring-amber-200" },
  checked_in: { label: "滞在中", style: "bg-blue-50 text-blue-800 ring-blue-200" },
  checked_out: { label: "出発済み", style: "bg-neutral-100 text-neutral-700 ring-neutral-200" },
  cancelled: { label: "キャンセル", style: "bg-red-50 text-red-700 ring-red-200" },
  blocked: { label: "在庫停止", style: "bg-violet-50 text-violet-800 ring-violet-200" },
};

function sourceLabel(source: string | null) {
  if (!source) return "不明";
  const labels: Record<string, string> = { stripe_web: "公式Web", rakuten_oyado: "楽天", manual: "手入力", booking_com: "Booking.com", airbnb: "Airbnb" };
  return labels[source] ?? source;
}

function importedAtLabel(createdAt: string) {
  try {
    return format(parseISO(createdAt), "yyyy/MM/dd HH:mm");
  } catch {
    return "—";
  }
}

export function ReservationList({ reservations, properties, rooms }: { reservations: Reservation[]; properties: Property[]; rooms: Room[] }) {
  const [modal, setModal] = useState<ModalState>({ mode: "closed" });
  const roomById = new Map(rooms.map((room) => [room.id, room]));
  const propertyById = new Map(properties.map((property) => [property.id, property]));

  if (reservations.length === 0) {
    return <div className="mt-5 rounded-xl border border-dashed border-neutral-300 bg-white px-6 py-14 text-center"><svg aria-hidden="true" viewBox="0 0 24 24" className="mx-auto h-9 w-9 text-neutral-300" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M7 3v3m10-3v3M4 9h16M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z" /></svg><h2 className="mt-3 font-semibold text-neutral-800">条件に合う予約がありません</h2><p className="mt-1 text-sm text-neutral-500">日付の範囲を広げるか、キーワードを短くしてお試しください。</p><a href="/reservations/list" className="mt-5 inline-flex min-h-11 items-center rounded-lg border border-neutral-300 px-4 text-sm font-medium hover:bg-neutral-50">条件をクリア</a></div>;
  }

  return <>
    <div className="mt-5 hidden overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm md:block">
      <div className="overflow-x-auto"><table className="w-full min-w-[1200px] text-left text-sm"><thead className="bg-neutral-50 text-xs text-neutral-500"><tr><th className="px-5 py-3 font-medium">宿泊日</th><th className="px-4 py-3 font-medium">お客様</th><th className="px-4 py-3 font-medium">施設・部屋</th><th className="px-4 py-3 font-medium">人数</th><th className="px-4 py-3 font-medium">予約経路</th><th className="px-4 py-3 font-medium">取込日時</th><th className="px-4 py-3 font-medium">支払い</th><th className="px-4 py-3 font-medium">ステータス</th><th className="px-5 py-3 text-right font-medium">操作</th></tr></thead><tbody className="divide-y divide-neutral-100">{reservations.map((reservation) => {
        const room = reservation.room_id ? roomById.get(reservation.room_id) : undefined;
        const property = propertyById.get(room?.property_id ?? reservation.requested_property_id ?? "");
        return <tr key={reservation.id} className="transition-colors hover:bg-blue-50/40"><td className="whitespace-nowrap px-5 py-4"><p className="font-medium tabular-nums">{format(parseISO(reservation.check_in_date), "M/d(E)", { locale: ja })} 〜 {format(parseISO(reservation.check_out_date), "M/d(E)", { locale: ja })}</p><p className="mt-1 text-xs text-neutral-500">{Math.max(0, differenceInCalendarDays(parseISO(reservation.check_out_date), parseISO(reservation.check_in_date)))}泊</p></td><td className="max-w-[220px] px-4 py-4"><p className="truncate font-semibold text-neutral-950">{reservation.guest_name}</p><p className="mt-1 truncate text-xs text-neutral-500">{reservation.guest_phone || reservation.guest_email || "連絡先未登録"}</p></td><td className="px-4 py-4"><p>{property?.name ?? "施設未割当"}</p><p className="mt-1 text-xs text-neutral-500">{room ? `${room.room_number}号室` : "部屋未割当"}</p></td><td className="whitespace-nowrap px-4 py-4 tabular-nums">{reservation.guest_count}名</td><td className="whitespace-nowrap px-4 py-4">{sourceLabel(reservation.source)}</td><td className="whitespace-nowrap px-4 py-4 text-xs tabular-nums text-neutral-600">{importedAtLabel(reservation.created_at)}</td><td className="whitespace-nowrap px-4 py-4">{reservation.payment_method === "onsite" ? "現地決済" : "オンライン"}</td><td className="px-4 py-4"><StatusBadge status={reservation.status} /></td><td className="px-5 py-4 text-right"><button type="button" onClick={() => setModal({ mode: "view", reservation })} className="min-h-11 rounded-lg border border-neutral-300 bg-white px-4 text-sm font-medium hover:border-blue-300 hover:bg-blue-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600">詳細を開く</button></td></tr>;
      })}</tbody></table></div>
    </div>

    <div className="mt-5 space-y-3 md:hidden">{reservations.map((reservation) => {
      const room = reservation.room_id ? roomById.get(reservation.room_id) : undefined;
      const property = propertyById.get(room?.property_id ?? reservation.requested_property_id ?? "");
      return <button key={reservation.id} type="button" onClick={() => setModal({ mode: "view", reservation })} className="block min-h-11 w-full rounded-xl border border-neutral-200 bg-white p-4 text-left shadow-sm transition-colors active:bg-neutral-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="truncate font-semibold text-neutral-950">{reservation.guest_name}</p><p className="mt-1 text-sm tabular-nums text-neutral-600">{format(parseISO(reservation.check_in_date), "M/d(E)", { locale: ja })} 〜 {format(parseISO(reservation.check_out_date), "M/d(E)", { locale: ja })}</p></div><StatusBadge status={reservation.status} /></div><div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-neutral-500"><span className="truncate">{property?.name ?? "施設未割当"} / {room ? `${room.room_number}号室` : "部屋未割当"}</span><span className="text-right">{reservation.guest_count}名・{sourceLabel(reservation.source)}</span><span>{reservation.payment_method === "onsite" ? "現地決済" : "オンライン決済"}</span><span className="text-right tabular-nums">取込 {importedAtLabel(reservation.created_at)}</span><span className="col-span-2 text-right text-blue-700">詳細を開く →</span></div></button>;
    })}</div>

    <ReservationModal state={modal} onClose={() => setModal({ mode: "closed" })} properties={properties} rooms={rooms} />
  </>;
}

function StatusBadge({ status }: { status: ReservationStatus }) {
  const current = STATUS[status];
  return <span className={clsx("inline-flex whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset", current.style)}>{current.label}</span>;
}
