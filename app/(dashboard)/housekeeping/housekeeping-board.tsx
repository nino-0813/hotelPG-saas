"use client";
import { useState, useTransition } from "react";
import type { Staff } from "@/lib/types/database";
import type { CleaningRow } from "./page";
import { updateCleaningTask } from "./actions";

export function HousekeepingBoard({ tasks, staff, dateLabel }: { tasks: CleaningRow[]; staff: Staff[]; dateLabel: string }) {
  const [showDone, setShowDone] = useState(false);
  const visible = showDone ? tasks : tasks.filter((t) => t.status !== "done");
  return <main className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6">
    <div className="flex flex-wrap items-end justify-between gap-4 print:hidden"><div><p className="text-sm font-medium text-emerald-700">客室・清掃業務</p><h1 className="mt-1 text-2xl font-semibold">清掃リスト</h1><p className="mt-1 text-sm text-neutral-500">{dateLabel} の清掃対象・担当者・完了期限</p></div><div className="flex gap-2"><label className="flex min-h-11 items-center gap-2 rounded-lg border border-neutral-300 px-3 text-sm"><input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} />完了済みも表示</label><button onClick={() => window.print()} className="min-h-11 rounded-lg bg-neutral-900 px-4 text-sm font-semibold text-white hover:bg-neutral-700">印刷する</button></div></div>
    <div className="hidden print:block"><h1 className="text-xl font-bold">HotelPG 清掃リスト</h1><p>{dateLabel}</p></div>
    <section className="mt-6 space-y-3">{visible.map((task) => <CleaningCard key={task.id} task={task} staff={staff} />)}{!visible.length && <p className="rounded-xl border border-dashed p-12 text-center text-sm text-neutral-500">未完了の清掃はありません。</p>}</section>
  </main>;
}

function CleaningCard({ task, staff }: { task: CleaningRow; staff: Staff[] }) {
  const [pending, startTransition] = useTransition();
  const [assignee, setAssignee] = useState(task.assignee_id ?? "");
  const save = (status: string, nextAssignee = assignee) => startTransition(async () => {
    await updateCleaningTask(task.id, status, nextAssignee);
  });
  return <article className={`grid gap-3 rounded-xl border bg-white p-4 shadow-sm sm:grid-cols-[180px_1fr_180px_auto] sm:items-center ${pending ? "opacity-50" : ""}`}>
    <div><p className="text-xs text-neutral-500">{task.room.property.name}</p><p className="text-xl font-semibold">客室 {task.room.room_number}</p></div>
    <div><p className="text-sm font-medium">{task.reservation?.guest_name ? `${task.reservation.guest_name}様 退室後` : task.note || "通常清掃"}</p><p className="mt-1 text-xs text-neutral-500">完了期限 {new Date(task.scheduled_for).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" })}{task.note ? ` / ${task.note}` : ""}</p></div>
    <label className="text-xs font-medium text-neutral-600 print:text-sm">担当者<select value={assignee} onChange={(e) => { setAssignee(e.target.value); save(task.status, e.target.value); }} disabled={pending} className="mt-1 min-h-11 w-full rounded-lg border border-neutral-300 bg-white px-2 text-sm print:hidden"><option value="">未割当</option>{staff.map((s) => <option key={s.id} value={s.id}>{s.display_name}</option>)}</select><span className="hidden font-normal print:block">{staff.find((s) => s.id === assignee)?.display_name ?? "未割当"}</span></label>
    <div className="flex gap-2 print:hidden">{task.status === "done" ? <button onClick={() => save("todo")} disabled={pending} className="min-h-11 rounded-lg border px-3 text-sm">未完了に戻す</button> : <><button onClick={() => save("in_progress")} disabled={pending} className="min-h-11 rounded-lg border border-amber-300 bg-amber-50 px-3 text-sm">作業開始</button><button onClick={() => save("done")} disabled={pending} className="min-h-11 rounded-lg bg-emerald-600 px-4 text-sm font-semibold text-white">完了</button></>}</div>
    <div className="hidden print:block">□ 完了</div>
  </article>;
}
