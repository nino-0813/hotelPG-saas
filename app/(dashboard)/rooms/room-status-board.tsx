"use client";

import { useMemo, useTransition } from "react";
import { format } from "date-fns";
import { ja } from "date-fns/locale";
import clsx from "clsx";
import type {
  Property,
  Reservation,
  Room,
  RoomStatusRow,
  RoomStatusValue,
  Task,
} from "@/lib/types/database";
import { updateRoomStatus } from "./actions";

const STATUS_ORDER: RoomStatusValue[] = [
  "uncleaned",
  "cleaning",
  "ready",
  "occupied",
];

const STATUS_LABEL: Record<RoomStatusValue, string> = {
  uncleaned: "未清掃",
  cleaning: "清掃中",
  ready: "準備完了",
  occupied: "滞在中",
};

const STATUS_STYLE: Record<
  RoomStatusValue,
  { accent: string; pill: string; pillActive: string; emoji: string }
> = {
  uncleaned: {
    accent: "bg-red-500",
    pill: "bg-red-50 text-red-700",
    pillActive: "bg-red-600 text-white",
    emoji: "🧺",
  },
  cleaning: {
    accent: "bg-amber-500",
    pill: "bg-amber-50 text-amber-700",
    pillActive: "bg-amber-600 text-white",
    emoji: "🧹",
  },
  ready: {
    accent: "bg-emerald-500",
    pill: "bg-emerald-50 text-emerald-700",
    pillActive: "bg-emerald-600 text-white",
    emoji: "✓",
  },
  occupied: {
    accent: "bg-sky-500",
    pill: "bg-sky-50 text-sky-700",
    pillActive: "bg-sky-600 text-white",
    emoji: "👤",
  },
};

type Props = {
  properties: Property[];
  rooms: Room[];
  statuses: RoomStatusRow[];
  currentReservations: Reservation[];
  upcomingReservations: Reservation[];
  openTasks: Task[];
};

export function RoomStatusBoard({
  properties,
  rooms,
  statuses,
  currentReservations,
  upcomingReservations,
  openTasks,
}: Props) {
  const statusByRoom = useMemo(() => {
    const m = new Map<string, RoomStatusRow>();
    for (const s of statuses) m.set(s.room_id, s);
    return m;
  }, [statuses]);

  const currentByRoom = useMemo(() => {
    const m = new Map<string, Reservation>();
    for (const r of currentReservations) m.set(r.room_id, r);
    return m;
  }, [currentReservations]);

  const upcomingByRoom = useMemo(() => {
    const m = new Map<string, Reservation>();
    for (const r of upcomingReservations) {
      if (!m.has(r.room_id)) m.set(r.room_id, r);
    }
    return m;
  }, [upcomingReservations]);

  const taskCountByRoom = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of openTasks) {
      m.set(t.room_id, (m.get(t.room_id) ?? 0) + 1);
    }
    return m;
  }, [openTasks]);

  // Summary counts
  const summaryCounts = useMemo(() => {
    const counts: Record<RoomStatusValue, number> = {
      uncleaned: 0,
      cleaning: 0,
      ready: 0,
      occupied: 0,
    };
    for (const r of rooms) {
      const s = statusByRoom.get(r.id)?.status ?? "ready";
      counts[s] += 1;
    }
    return counts;
  }, [rooms, statusByRoom]);

  return (
    <>
      {/* Summary bar */}
      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {STATUS_ORDER.map((s) => (
          <SummaryCard
            key={s}
            status={s}
            count={summaryCounts[s]}
            total={rooms.length}
          />
        ))}
      </div>

      {/* Property groups */}
      <div className="space-y-6">
        {properties.map((p) => {
          const propRooms = rooms
            .filter((r) => r.property_id === p.id)
            .sort((a, b) => a.display_order - b.display_order);

          if (propRooms.length === 0) return null;

          return (
            <section key={p.id}>
              <header className="mb-2 flex items-baseline gap-2 border-b border-neutral-200 pb-1.5">
                <h2 className="text-sm font-semibold uppercase tracking-wide">
                  {p.name}
                </h2>
                <span className="text-xs text-neutral-500">
                  {propRooms.length}部屋
                </span>
              </header>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {propRooms.map((room) => (
                  <RoomCard
                    key={room.id}
                    room={room}
                    status={statusByRoom.get(room.id)?.status ?? "ready"}
                    statusUpdatedAt={statusByRoom.get(room.id)?.updated_at}
                    current={currentByRoom.get(room.id) ?? null}
                    upcoming={upcomingByRoom.get(room.id) ?? null}
                    openTaskCount={taskCountByRoom.get(room.id) ?? 0}
                  />
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </>
  );
}

function SummaryCard({
  status,
  count,
  total,
}: {
  status: RoomStatusValue;
  count: number;
  total: number;
}) {
  const style = STATUS_STYLE[status];
  return (
    <div className="flex items-center gap-3 rounded-md border border-neutral-200 bg-white px-4 py-3 shadow-sm">
      <div
        className={clsx(
          "flex h-10 w-10 items-center justify-center rounded-md text-lg",
          style.pill,
        )}
      >
        {style.emoji}
      </div>
      <div>
        <div className="text-xs text-neutral-500">{STATUS_LABEL[status]}</div>
        <div className="text-xl font-semibold tabular-nums">
          {count}
          <span className="ml-1 text-xs font-normal text-neutral-400">
            / {total}
          </span>
        </div>
      </div>
    </div>
  );
}

function RoomCard({
  room,
  status,
  statusUpdatedAt,
  current,
  upcoming,
  openTaskCount,
}: {
  room: Room;
  status: RoomStatusValue;
  statusUpdatedAt: string | undefined;
  current: Reservation | null;
  upcoming: Reservation | null;
  openTaskCount: number;
}) {
  const [pending, startTransition] = useTransition();
  const style = STATUS_STYLE[status];

  const onChangeStatus = (next: RoomStatusValue) => {
    if (next === status) return;
    startTransition(async () => {
      await updateRoomStatus(room.id, next);
    });
  };

  return (
    <div
      className={clsx(
        "relative overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-sm transition",
        pending && "opacity-60",
      )}
    >
      {/* Status accent bar */}
      <div className={clsx("h-1.5 w-full", style.accent)} />

      <div className="p-4">
        {/* Header: Room number + status badge */}
        <div className="mb-3 flex items-start justify-between">
          <div>
            <div className="text-2xl font-semibold tabular-nums">
              {room.room_number}
            </div>
            <div className="text-[11px] text-neutral-500">
              {roomTypeLabel(room.room_type)}
            </div>
          </div>
          <span
            className={clsx(
              "rounded-md px-2 py-1 text-xs font-semibold",
              style.pill,
            )}
          >
            {style.emoji} {STATUS_LABEL[status]}
          </span>
        </div>

        {/* Current / upcoming reservation */}
        <div className="mb-3 min-h-[46px] space-y-1.5 text-xs">
          {current ? (
            <ReservationLine
              label="滞在中"
              icon="👤"
              guest={current.guest_name}
              dateRange={`${format(new Date(`${current.check_in_date}T00:00:00`), "M/d")} → ${format(new Date(`${current.check_out_date}T00:00:00`), "M/d")}`}
              tone="filled"
            />
          ) : null}
          {upcoming ? (
            <ReservationLine
              label="次の予約"
              icon="🛬"
              guest={upcoming.guest_name}
              dateRange={`${format(new Date(`${upcoming.check_in_date}T00:00:00`), "M/d (EEE)", { locale: ja })} 〜`}
              tone="muted"
            />
          ) : null}
          {!current && !upcoming ? (
            <div className="text-neutral-400">予約なし（〜1週間）</div>
          ) : null}
        </div>

        {/* Open task count */}
        {openTaskCount > 0 ? (
          <a
            href="/tasks?range=week&status=active"
            className="mb-3 flex items-center gap-1.5 rounded-md bg-amber-50 px-2 py-1 text-[11px] font-medium text-amber-800 hover:bg-amber-100"
          >
            ⚠️ 未完了タスク {openTaskCount}件
          </a>
        ) : null}

        {/* Status pills */}
        <div className="grid grid-cols-2 gap-1.5 sm:flex sm:flex-wrap">
          {STATUS_ORDER.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => onChangeStatus(s)}
              disabled={pending}
              className={clsx(
                "rounded-md px-3 py-1.5 text-xs font-medium transition active:scale-95",
                s === status
                  ? STATUS_STYLE[s].pillActive
                  : "bg-neutral-100 text-neutral-600 hover:bg-neutral-200",
              )}
            >
              {STATUS_LABEL[s]}
            </button>
          ))}
        </div>

        {statusUpdatedAt ? (
          <div className="mt-2 text-[10px] text-neutral-400">
            更新: {format(new Date(statusUpdatedAt), "M/d HH:mm")}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function ReservationLine({
  label,
  icon,
  guest,
  dateRange,
  tone,
}: {
  label: string;
  icon: string;
  guest: string;
  dateRange: string;
  tone: "filled" | "muted";
}) {
  return (
    <div
      className={clsx(
        "flex items-center gap-2 truncate",
        tone === "muted" && "text-neutral-500",
      )}
    >
      <span className="shrink-0">{icon}</span>
      <span className="font-medium">{guest}</span>
      <span className="text-neutral-500">{dateRange}</span>
      <span className="ml-auto rounded bg-neutral-100 px-1.5 text-[9px] font-medium uppercase tracking-wide text-neutral-500">
        {label}
      </span>
    </div>
  );
}

function roomTypeLabel(type: Room["room_type"]) {
  switch (type) {
    case "family":
      return "ファミリー";
    case "single":
      return "シングル";
    case "standard":
      return "スタンダード";
  }
}
