"use client";
import { useState, useTransition } from "react";
import { addDays, differenceInCalendarDays, format, parseISO } from "date-fns";
import { useRouter } from "next/navigation";
import type { Staff } from "@/lib/types/database";
import type { CheckInRow, CleaningRow } from "./page";
import { updateCleaningTask } from "./actions";

export function HousekeepingBoard({ tasks, checkIns, staff, selectedDate, dateLabel }: { tasks: CleaningRow[]; checkIns: CheckInRow[]; staff: Staff[]; selectedDate: string; dateLabel: string }) {
  const router = useRouter();
  const [showDone, setShowDone] = useState(false);
  const checkInByRoom = new Map(checkIns.map((reservation) => [reservation.room_id, reservation]));
  const visibleTasks = tasks.filter((task) => showDone || task.status !== "done" || checkInByRoom.has(task.room_id));
  const taskRoomIds = new Set(visibleTasks.map((task) => task.room_id));
  const checkInOnly = checkIns.filter((reservation) => !taskRoomIds.has(reservation.room_id ?? ""));
  const rowCount = visibleTasks.length + checkInOnly.length;
  const moveDate = (date: string) => router.push(`/housekeeping?date=${date}`);
  const adjacentDate = (days: number) => format(addDays(parseISO(selectedDate), days), "yyyy-MM-dd");
  return <main className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6">
    <div className="flex flex-wrap items-end justify-between gap-4 print:hidden"><div><p className="text-sm font-medium text-emerald-700">客室・清掃業務</p><h1 className="mt-1 text-2xl font-semibold">清掃リスト</h1><p className="mt-1 text-sm text-neutral-500">{dateLabel} の清掃対象・担当者・完了期限</p></div><div className="flex flex-wrap gap-2"><label className="flex min-h-11 items-center gap-2 rounded-lg border border-neutral-300 px-3 text-sm"><input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} />完了済みも表示</label><button onClick={() => window.print()} className="min-h-11 rounded-lg bg-neutral-900 px-4 text-sm font-semibold text-white hover:bg-neutral-700">印刷する</button></div></div>
    <div className="mt-5 flex flex-wrap items-center gap-2 rounded-xl border border-neutral-200 bg-white p-3 shadow-sm print:hidden">
      <button type="button" onClick={() => moveDate(adjacentDate(-1))} className="min-h-11 rounded-lg border border-neutral-300 px-4 text-sm font-medium hover:bg-neutral-50" aria-label="前日の清掃リスト">← 前日</button>
      <label className="text-xs font-medium text-neutral-600">清掃日<input type="date" value={selectedDate} onChange={(e) => moveDate(e.target.value)} className="ml-2 min-h-11 rounded-lg border border-neutral-300 bg-white px-3 text-sm text-neutral-900" /></label>
      <button type="button" onClick={() => moveDate(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo" }).format(new Date()))} className="min-h-11 rounded-lg border border-neutral-300 px-4 text-sm font-medium hover:bg-neutral-50">今日</button>
      <button type="button" onClick={() => moveDate(adjacentDate(1))} className="min-h-11 rounded-lg border border-neutral-300 px-4 text-sm font-medium hover:bg-neutral-50" aria-label="翌日の清掃リスト">翌日 →</button>
      <span className="ml-auto text-sm text-neutral-500">{rowCount}室（チェックアウト {tasks.length}件・チェックイン {checkIns.length}件）</span>
    </div>
    <div className="hidden print:block"><h1 className="text-xl font-bold">HotelPG 清掃リスト</h1><p>{dateLabel}</p></div>
    <section className="mt-6 space-y-3">{visibleTasks.map((task) => <CleaningCard key={task.id} task={task} checkIn={checkInByRoom.get(task.room_id)} staff={staff} selectedDate={selectedDate} />)}{checkInOnly.map((reservation) => <CheckInOnlyCard key={reservation.id} reservation={reservation} selectedDate={selectedDate} />)}{!rowCount && <p className="rounded-xl border border-dashed p-12 text-center text-sm text-neutral-500">{dateLabel} のチェックアウト・チェックイン予定はありません。</p>}</section>
  </main>;
}

function StayBadge({ checkInDate, checkOutDate, selectedDate }: { checkInDate: string; checkOutDate: string; selectedDate: string }) {
  const nights = differenceInCalendarDays(parseISO(checkOutDate), parseISO(checkInDate));
  const currentNight = Math.min(nights, Math.max(1, differenceInCalendarDays(parseISO(selectedDate), parseISO(checkInDate)) + 1));
  const dateRange = `${format(parseISO(checkInDate), "M/d")}〜${format(parseISO(checkOutDate), "M/d")}`;
  return nights >= 2 ? <span className="rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-xs font-bold text-amber-800 print:border-black print:bg-white print:text-black">連泊｜{dateRange}｜{currentNight}泊目／全{nights}泊</span> : null;
}

function CheckInDetails({ reservation, selectedDate }: { reservation: CheckInRow; selectedDate: string }) {
  return <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 print:border-black print:bg-white">
    <div className="flex flex-wrap items-center gap-2"><span className="rounded bg-blue-700 px-2 py-0.5 text-xs font-bold text-white print:border print:border-black print:bg-white print:text-black">チェックイン {reservation.check_in_time.slice(0, 5)}</span><p className="text-sm font-semibold text-blue-950 print:text-black">{reservation.guest_name}様・{reservation.guest_count}名</p><StayBadge checkInDate={reservation.check_in_date} checkOutDate={reservation.check_out_date} selectedDate={selectedDate} /></div>
    {reservation.special_notes && <p className="mt-1 text-xs text-blue-900 print:text-black">注意事項：{reservation.special_notes}</p>}
  </div>;
}

function CleaningCard({ task, checkIn, staff, selectedDate }: { task: CleaningRow; checkIn?: CheckInRow; staff: Staff[]; selectedDate: string }) {
  const [pending, startTransition] = useTransition();
  const [assignee, setAssignee] = useState(task.assignee_id ?? "");
  const save = (status: string, nextAssignee = assignee) => startTransition(async () => {
    await updateCleaningTask(task.id, status, nextAssignee);
  });
  return <article className={`grid gap-3 rounded-xl border bg-white p-4 shadow-sm sm:grid-cols-[160px_minmax(260px,1fr)_180px_auto] sm:items-center ${pending ? "opacity-50" : ""}`}>
    <div><p className="text-xs text-neutral-500">{task.room.property.name}</p><p className="text-xl font-semibold">客室 {task.room.room_number}</p></div>
    <div className="space-y-2"><div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 print:border-black print:bg-white"><div className="flex flex-wrap items-center gap-2"><span className="rounded bg-rose-700 px-2 py-0.5 text-xs font-bold text-white print:border print:border-black print:bg-white print:text-black">チェックアウト {task.reservation?.check_out_time?.slice(0, 5) ?? new Date(task.scheduled_for).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Tokyo" })}</span><p className="text-sm font-semibold text-rose-950 print:text-black">{task.reservation?.guest_name ? `${task.reservation.guest_name}様` : "通常清掃"}</p>{task.reservation && <StayBadge checkInDate={task.reservation.check_in_date} checkOutDate={task.reservation.check_out_date} selectedDate={selectedDate} />}</div>{task.reservation?.special_notes && <p className="mt-1 text-xs text-rose-900 print:text-black">注意事項：{task.reservation.special_notes}</p>}</div>{checkIn ? <CheckInDetails reservation={checkIn} selectedDate={selectedDate} /> : <p className="rounded-lg border border-dashed border-neutral-300 px-3 py-2 text-xs text-neutral-500">本日のチェックイン予定なし</p>}</div>
    <label className="text-xs font-medium text-neutral-600 print:text-sm">担当者<select value={assignee} onChange={(e) => { setAssignee(e.target.value); save(task.status, e.target.value); }} disabled={pending} className="mt-1 min-h-11 w-full rounded-lg border border-neutral-300 bg-white px-2 text-sm print:hidden"><option value="">未割当</option>{staff.map((s) => <option key={s.id} value={s.id}>{s.display_name}</option>)}</select><span className="hidden font-normal print:block">{staff.find((s) => s.id === assignee)?.display_name ?? "未割当"}</span></label>
    <div className="flex gap-2 print:hidden">{task.status === "done" ? <button onClick={() => save("todo")} disabled={pending} className="min-h-11 rounded-lg border px-3 text-sm">未完了に戻す</button> : <><button onClick={() => save("in_progress")} disabled={pending} className="min-h-11 rounded-lg border border-amber-300 bg-amber-50 px-3 text-sm">作業開始</button><button onClick={() => save("done")} disabled={pending} className="min-h-11 rounded-lg bg-emerald-600 px-4 text-sm font-semibold text-white">完了</button></>}</div>
    <div className="hidden print:block">□ 完了</div>
  </article>;
}

function CheckInOnlyCard({ reservation, selectedDate }: { reservation: CheckInRow; selectedDate: string }) {
  return <article className="grid gap-3 rounded-xl border border-blue-200 bg-white p-4 shadow-sm sm:grid-cols-[160px_minmax(260px,1fr)_180px_auto] sm:items-center">
    <div><p className="text-xs text-neutral-500">{reservation.room.property.name}</p><p className="text-xl font-semibold">客室 {reservation.room.room_number}</p></div>
    <div className="space-y-2"><p className="rounded-lg border border-dashed border-neutral-300 px-3 py-2 text-xs text-neutral-500">本日のチェックアウト予定なし</p><CheckInDetails reservation={reservation} selectedDate={selectedDate} /></div>
    <p className="text-xs text-neutral-500">清掃タスクなし</p>
    <div className="hidden print:block">□ 確認</div>
  </article>;
}
