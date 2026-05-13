"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
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
import { roomTypeLabel } from "@/lib/room-type-labels";
import { updateRoomStatus } from "./actions";

const SUMMARY_STATUS_ORDER: RoomStatusValue[] = [
  "uncleaned",
  "ready",
  "occupied",
];

const STATUS_LABEL: Record<RoomStatusValue, string> = {
  uncleaned: "未清掃",
  cleaning: "清掃中",
  ready: "準備完了",
  occupied: "滞在中",
};

/** 部屋ボードの「滞在中／未清掃」境界（ホテル標準・DBの時刻は使わない） */
const DISPLAY_CHECK_IN = "15:00";
const DISPLAY_CHECK_OUT = "10:00";

function toLocalDateTime(date: string, timeHm: string) {
  return new Date(`${date}T${timeHm}:00`);
}

function isOccupiedByTime(r: Reservation, now: Date) {
  const checkInAt = toLocalDateTime(r.check_in_date, DISPLAY_CHECK_IN);
  const checkOutAt = toLocalDateTime(r.check_out_date, DISPLAY_CHECK_OUT);
  return now >= checkInAt && now < checkOutAt;
}

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
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const tick = () => setNow(new Date());
    const id = setInterval(tick, 60_000);
    const onVisible = () => {
      if (document.visibilityState === "visible") tick();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);
  const today = useMemo(() => format(now, "yyyy-MM-dd"), [now]);

  const statusByRoom = useMemo(() => {
    const m = new Map<string, RoomStatusRow>();
    for (const s of statuses) m.set(s.room_id, s);
    return m;
  }, [statuses]);

  const currentByRoom = useMemo(() => {
    const m = new Map<string, Reservation>();
    for (const r of currentReservations) {
      if (!r.room_id) continue;
      if (isOccupiedByTime(r, now)) m.set(r.room_id, r);
    }
    return m;
  }, [currentReservations, now]);

  const checkedOutTodayByRoom = useMemo(() => {
    const m = new Map<string, Reservation>();
    for (const r of currentReservations) {
      if (!r.room_id) continue;
      if (r.check_out_date !== today) continue;
      const checkOutAt = toLocalDateTime(
        r.check_out_date,
        DISPLAY_CHECK_OUT,
      );
      if (now >= checkOutAt) m.set(r.room_id, r);
    }
    return m;
  }, [currentReservations, now, today]);

  const upcomingByRoom = useMemo(() => {
    const m = new Map<string, Reservation>();
    for (const r of upcomingReservations) {
      if (r.room_id && !m.has(r.room_id)) m.set(r.room_id, r);
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

  const effectiveStatusByRoom = useMemo(() => {
    const m = new Map<string, RoomStatusValue>();
    for (const room of rooms) {
      const base = statusByRoom.get(room.id)?.status ?? "ready";
      if (currentByRoom.has(room.id)) {
        m.set(room.id, "occupied");
        continue;
      }
      // After 10:00 on checkout day: show 未清掃 until staff marks 準備完了
      // (room_status.ready) *after* checkout. If DB is still "ready" from before
      // the stay, treat as needing clean — only trust ready when updated_at >= checkout.
      if (checkedOutTodayByRoom.has(room.id)) {
        const checkoutRes = checkedOutTodayByRoom.get(room.id)!;
        const checkOutAt = toLocalDateTime(
          checkoutRes.check_out_date,
          DISPLAY_CHECK_OUT,
        );
        const row = statusByRoom.get(room.id);
        const updatedAt = row?.updated_at ? new Date(row.updated_at) : null;
        const readyAfterCheckout =
          base === "ready" &&
          updatedAt != null &&
          !Number.isNaN(updatedAt.getTime()) &&
          updatedAt >= checkOutAt;
        if (!readyAfterCheckout) {
          m.set(room.id, "uncleaned");
          continue;
        }
      }
      m.set(room.id, base);
    }
    return m;
  }, [rooms, statusByRoom, currentByRoom, checkedOutTodayByRoom]);

  // Summary counts
  const summaryCounts = useMemo(() => {
    const counts: Record<RoomStatusValue, number> = {
      uncleaned: 0,
      cleaning: 0,
      ready: 0,
      occupied: 0,
    };
    for (const r of rooms) {
      const s = effectiveStatusByRoom.get(r.id) ?? "ready";
      counts[s] += 1;
    }
    return counts;
  }, [rooms, effectiveStatusByRoom]);

  return (
    <>
      {/* Summary bar */}
      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
        {SUMMARY_STATUS_ORDER.map((s) => (
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
                    status={effectiveStatusByRoom.get(room.id) ?? "ready"}
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

  const onMarkReady = () => {
    if (status === "ready") return;
    startTransition(async () => {
      await updateRoomStatus(room.id, "ready");
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
              smartKeyCode={current.smart_key_code}
              guestCount={current.guest_count}
            />
          ) : null}
          {upcoming ? (
            <ReservationLine
              label="次の予約"
              icon="🛬"
              guest={upcoming.guest_name}
              dateRange={`${format(new Date(`${upcoming.check_in_date}T00:00:00`), "M/d (EEE)", { locale: ja })} 〜`}
              tone="muted"
              smartKeyCode={upcoming.smart_key_code}
              guestCount={upcoming.guest_count}
            />
          ) : null}
          {!current && !upcoming ? (
            <div className="text-neutral-400">予約なし（〜1週間）</div>
          ) : null}
        </div>

        {/* Status pills */}
        <div>
          <button
            type="button"
            onClick={onMarkReady}
            disabled={pending || status === "occupied" || status === "ready"}
            className={clsx(
              "w-full rounded-md px-3 py-2 text-xs font-semibold transition active:scale-[0.99]",
              status === "ready"
                ? "bg-neutral-100 text-neutral-400"
                : "bg-emerald-600 text-white hover:bg-emerald-700 disabled:bg-neutral-100 disabled:text-neutral-400",
            )}
          >
            準備完了にする
          </button>
          {status === "occupied" ? (
            <div className="mt-1 text-[10px] text-neutral-400">
              滞在中は変更できません（{DISPLAY_CHECK_IN}〜 / 〜
              {DISPLAY_CHECK_OUT}）
            </div>
          ) : null}
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
  smartKeyCode,
  guestCount,
}: {
  label: string;
  icon: string;
  guest: string;
  dateRange: string;
  tone: "filled" | "muted";
  smartKeyCode?: string | null;
  guestCount?: number;
}) {
  const code = smartKeyCode?.trim();
  const showMeta = Boolean(code) || guestCount != null;

  return (
    <div className="space-y-0.5">
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
      {showMeta ? (
        <div
          className={clsx(
            "flex flex-wrap gap-x-3 gap-y-0.5 pl-6 text-[11px] tabular-nums",
            tone === "muted" ? "text-neutral-500" : "text-neutral-600",
          )}
        >
          {code ? (
            <span>
              パスワード <span className="font-semibold">{code}</span>
            </span>
          ) : null}
          {guestCount != null ? <span>{guestCount}名</span> : null}
        </div>
      ) : null}
    </div>
  );
}

