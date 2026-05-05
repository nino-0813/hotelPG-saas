"use client";

import { Fragment, useTransition } from "react";
import { format, isPast, isToday } from "date-fns";
import { ja } from "date-fns/locale";
import clsx from "clsx";
import type { TaskType } from "@/lib/types/database";
import { assignTaskToMe, unassignTask, updateTaskStatus } from "./actions";
import type { TaskWithJoins } from "./page";

export function TaskList({
  tasks,
  currentUserId,
}: {
  tasks: TaskWithJoins[];
  currentUserId: string | null;
}) {
  if (tasks.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-neutral-300 bg-white px-6 py-16 text-center">
        <p className="text-sm text-neutral-500">該当するタスクはありません</p>
      </div>
    );
  }

  // Group by date (yyyy-MM-dd of scheduled_for)
  const groups = new Map<string, TaskWithJoins[]>();
  for (const t of tasks) {
    const key = format(new Date(t.scheduled_for), "yyyy-MM-dd");
    const arr = groups.get(key) ?? [];
    arr.push(t);
    groups.set(key, arr);
  }

  return (
    <div className="space-y-6">
      {Array.from(groups.entries()).map(([dateKey, group]) => {
        const date = new Date(`${dateKey}T00:00:00`);
        const isOverdue = isPast(date) && !isToday(date);
        return (
          <section key={dateKey}>
            <header className="mb-2 flex items-baseline gap-3 border-b border-neutral-200 pb-1.5">
              <h2
                className={clsx(
                  "text-sm font-semibold",
                  isOverdue && "text-red-700",
                )}
              >
                {format(date, "M/d (EEE)", { locale: ja })}
                {isToday(date) ? (
                  <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-900">
                    今日
                  </span>
                ) : null}
                {isOverdue ? (
                  <span className="ml-2 rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-medium text-red-900">
                    期限超過
                  </span>
                ) : null}
              </h2>
              <span className="text-xs text-neutral-500">{group.length}件</span>
            </header>
            <div className="space-y-2">
              {group.map((task) => (
                <TaskCard
                  key={task.id}
                  task={task}
                  currentUserId={currentUserId}
                />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function TaskCard({
  task,
  currentUserId,
}: {
  task: TaskWithJoins;
  currentUserId: string | null;
}) {
  const [pending, startTransition] = useTransition();

  const onChangeStatus = (status: "todo" | "in_progress" | "done") => {
    startTransition(async () => {
      await updateTaskStatus(task.id, status);
    });
  };

  const onAssignToggle = () => {
    startTransition(async () => {
      if (task.assignee_id === currentUserId) {
        await unassignTask(task.id);
      } else {
        await assignTaskToMe(task.id);
      }
    });
  };

  const typeStyle = typeStyleFor(task.type);
  const isMine = task.assignee_id && task.assignee_id === currentUserId;

  const timeBlock = (
    <div className="flex shrink-0 items-center gap-3">
      <div className="text-center">
        <div
          className={clsx(
            "text-base font-semibold tabular-nums",
            task.status === "done" && "text-neutral-400 line-through",
          )}
        >
          {format(new Date(task.scheduled_for), "HH:mm")}
        </div>
        <div className="text-[10px] text-neutral-500">
          {format(new Date(task.scheduled_for), "M/d")}
        </div>
      </div>
      <span
        className={clsx(
          "rounded-md px-2 py-1 text-xs font-medium",
          typeStyle.bg,
          typeStyle.text,
        )}
      >
        {typeStyle.icon} {typeStyle.label}
      </span>
    </div>
  );

  const roomBlock = (
    <div className="shrink-0 text-right sm:text-left">
      <div className="text-[11px] text-neutral-500 sm:text-xs">
        {task.room.property.name}
      </div>
      <div className="text-sm font-semibold sm:font-medium">
        {task.room.room_number}
      </div>
    </div>
  );

  const noteBlock = (
    <div className="min-w-0 sm:flex-1">
      <div
        className={clsx(
          "text-sm sm:truncate",
          task.status === "done" && "text-neutral-400 line-through",
        )}
      >
        {task.note ?? "—"}
      </div>
      {task.reservation ? (
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-neutral-500">
          <span>👤 {task.reservation.guest_name}</span>
          <span>
            {task.reservation.check_in_date} → {task.reservation.check_out_date}
          </span>
          {task.reservation.payment_method === "onsite" ? (
            <span className="rounded bg-orange-100 px-1 text-[10px] font-medium text-orange-800">
              現地
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );

  return (
    <div
      className={clsx(
        "rounded-md border bg-white p-3 transition",
        statusBorder(task.status),
        pending && "opacity-50",
        task.status === "done" && "bg-neutral-50",
      )}
    >
      {/* Desktop: single row layout */}
      <div className="hidden items-center gap-4 sm:flex">
        <div className="sm:w-44">{timeBlock}</div>
        <div className="sm:w-32">{roomBlock}</div>
        {noteBlock}
        <PriorityBadge priority={task.priority} />
        <AssigneeButton
          isMine={!!isMine}
          hasOther={!!task.assignee_id && !isMine}
          onClick={onAssignToggle}
          disabled={pending}
        />
        <StatusActions
          status={task.status}
          onChange={onChangeStatus}
          disabled={pending}
        />
      </div>

      {/* Mobile: stacked layout */}
      <div className="space-y-2.5 sm:hidden">
        <div className="flex items-start justify-between gap-3">
          {timeBlock}
          {roomBlock}
        </div>
        {noteBlock}
        <div className="flex flex-wrap items-center gap-2">
          <PriorityBadge priority={task.priority} />
          <AssigneeButton
            isMine={!!isMine}
            hasOther={!!task.assignee_id && !isMine}
            onClick={onAssignToggle}
            disabled={pending}
          />
          <div className="ml-auto">
            <StatusActions
              status={task.status}
              onChange={onChangeStatus}
              disabled={pending}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function AssigneeButton({
  isMine,
  hasOther,
  onClick,
  disabled,
}: {
  isMine: boolean;
  hasOther: boolean;
  onClick: () => void;
  disabled: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={clsx(
        "rounded-md border px-2.5 py-1 text-xs transition",
        isMine
          ? "border-neutral-900 bg-neutral-900 text-white"
          : hasOther
            ? "border-neutral-300 bg-neutral-100 text-neutral-600"
            : "border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-50",
      )}
      title={
        isMine
          ? "担当を解除"
          : hasOther
            ? "他の人が担当中 (クリックで自分に変更)"
            : "自分が担当する"
      }
    >
      {isMine ? "✓ 自分" : hasOther ? "他者" : "担当する"}
    </button>
  );
}

function StatusActions({
  status,
  onChange,
  disabled,
}: {
  status: "todo" | "in_progress" | "done";
  onChange: (s: "todo" | "in_progress" | "done") => void;
  disabled: boolean;
}) {
  if (status === "todo") {
    return (
      <div className="flex gap-1">
        <button
          type="button"
          onClick={() => onChange("in_progress")}
          disabled={disabled}
          className="rounded-md bg-amber-500 px-3.5 py-1.5 text-xs font-medium text-white hover:bg-amber-600"
        >
          開始
        </button>
        <button
          type="button"
          onClick={() => onChange("done")}
          disabled={disabled}
          className="rounded-md border border-neutral-300 bg-white px-3.5 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-50"
        >
          完了
        </button>
      </div>
    );
  }
  if (status === "in_progress") {
    return (
      <div className="flex gap-1">
        <button
          type="button"
          onClick={() => onChange("done")}
          disabled={disabled}
          className="rounded-md bg-emerald-600 px-3.5 py-1.5 text-xs font-medium text-white hover:bg-emerald-700"
        >
          完了
        </button>
        <button
          type="button"
          onClick={() => onChange("todo")}
          disabled={disabled}
          className="rounded-md border border-neutral-300 bg-white px-3.5 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-50"
        >
          戻す
        </button>
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={() => onChange("todo")}
      disabled={disabled}
      className="rounded-md border border-neutral-300 bg-white px-3.5 py-1.5 text-xs font-medium text-neutral-500 hover:bg-neutral-50"
    >
      ✓ 完了 (取消)
    </button>
  );
}

function PriorityBadge({ priority }: { priority: number }) {
  const map: Record<number, { label: string; cls: string }> = {
    1: { label: "高", cls: "bg-red-100 text-red-800" },
    2: { label: "中", cls: "bg-neutral-100 text-neutral-700" },
    3: { label: "低", cls: "bg-neutral-50 text-neutral-500" },
  };
  const { label, cls } = map[priority] ?? map[2];
  return (
    <span
      className={clsx(
        "inline-block rounded px-1.5 py-0.5 text-[10px] font-medium",
        cls,
      )}
    >
      {label}
    </span>
  );
}

function statusBorder(status: "todo" | "in_progress" | "done") {
  switch (status) {
    case "todo":
      return "border-neutral-200";
    case "in_progress":
      return "border-amber-400 bg-amber-50/40";
    case "done":
      return "border-neutral-200";
  }
}

function typeStyleFor(type: TaskType): {
  label: string;
  icon: string;
  bg: string;
  text: string;
} {
  switch (type) {
    case "cleaning":
      return {
        label: "清掃",
        icon: "🧹",
        bg: "bg-emerald-100",
        text: "text-emerald-800",
      };
    case "prep":
      return {
        label: "準備",
        icon: "🛏️",
        bg: "bg-sky-100",
        text: "text-sky-800",
      };
    case "key_setup":
      return {
        label: "鍵",
        icon: "🔑",
        bg: "bg-violet-100",
        text: "text-violet-800",
      };
    case "special_check":
      return {
        label: "特記",
        icon: "⚠️",
        bg: "bg-red-100",
        text: "text-red-800",
      };
  }
}
