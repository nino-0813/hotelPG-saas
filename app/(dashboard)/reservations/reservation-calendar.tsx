"use client";

import { addDays, differenceInCalendarDays, format, isSameDay } from "date-fns";
import { ja } from "date-fns/locale";
import { useRouter } from "next/navigation";
import {
  useMemo,
  useRef,
  useState,
  useTransition,
  type DragEvent,
} from "react";
import clsx from "clsx";
import { moveReservationRoom } from "./actions";
import type {
  Property,
  Reservation,
  ReservationStatus,
  Room,
} from "@/lib/types/database";
import { roomTypeLabel } from "@/lib/room-type-labels";
import { ReservationModal, type ModalState } from "./reservation-modal";

type Props = {
  properties: Property[];
  rooms: Room[];
  reservations: Reservation[];
  startDate: string;
  days: number;
};

export function ReservationCalendar({
  properties,
  rooms,
  reservations,
  startDate,
  days,
}: Props) {
  const router = useRouter();
  const start = useMemo(() => new Date(startDate), [startDate]);
  const [modalState, setModalState] = useState<ModalState>({ mode: "closed" });
  const [draggingReservationId, setDraggingReservationId] = useState<
    string | null
  >(null);
  const [dropTargetRoomId, setDropTargetRoomId] = useState<string | null>(null);
  const [moveError, setMoveError] = useState<string | null>(null);
  const dragMovedRef = useRef(false);
  const [movePending, startMove] = useTransition();

  const openNewModal = (roomId: string, date: Date) => {
    if (draggingReservationId || dragMovedRef.current) return;
    setModalState({
      mode: "new",
      roomId,
      date: format(date, "yyyy-MM-dd"),
    });
  };
  const openViewModal = (reservation: Reservation) => {
    setModalState({ mode: "view", reservation });
  };
  const closeModal = () => setModalState({ mode: "closed" });

  const handleReservationDrop = (reservationId: string, targetRoomId: string) => {
    const r = reservations.find((x) => x.id === reservationId);
    if (!r?.room_id || r.room_id === targetRoomId) {
      setDraggingReservationId(null);
      setDropTargetRoomId(null);
      return;
    }
    setMoveError(null);
    startMove(async () => {
      const result = await moveReservationRoom({
        id: reservationId,
        room_id: targetRoomId,
      });
      setDraggingReservationId(null);
      setDropTargetRoomId(null);
      if (result.error) {
        setMoveError(result.error);
        return;
      }
      dragMovedRef.current = true;
      router.refresh();
    });
  };

  const dates = useMemo(
    () => Array.from({ length: days }, (_, i) => addDays(start, i)),
    [start, days],
  );

  const today = useMemo(() => {
    const t = new Date();
    t.setHours(0, 0, 0, 0);
    return t;
  }, []);

  type RoomGroup = {
    key: string;
    title: string;
    property: Property;
    rooms: Room[];
  };

  const { roomGroups, roomRowMap, totalRows } = useMemo(() => {
    const map = new Map<string, number>();
    const groups: RoomGroup[] = [];
    let row = 2; // row 1 = date header

    for (const p of properties) {
      const propRoomsAll = rooms
        .filter((r) => r.property_id === p.id)
        .sort((a, b) => a.display_order - b.display_order);

      // PG-III only: split into two clearer groups (4名×1 / 3名×9)
      if (p.code === "PG3") {
        // Make this robust even if room_type hasn't been migrated yet:
        // take the first room as "最大4名" and the rest as "最大3名".
        const g4 = propRoomsAll.slice(0, 1);
        const g3 = propRoomsAll.slice(1);

        const ordered: Array<{ key: string; title: string; rooms: Room[] }> = [
          {
            key: `${p.id}-max4`,
            title: `${p.name} / 和モダン 最大4名（セミダブル）`,
            rooms: g4,
          },
          {
            key: `${p.id}-max3`,
            title: `${p.name} / 和モダン 最大3名（長期滞在歓迎）`,
            rooms: g3,
          },
        ];

        for (const g of ordered) {
          if (g.rooms.length === 0) continue;
          row++; // header row per group
          groups.push({ key: g.key, title: g.title, property: p, rooms: g.rooms });
          for (const r of g.rooms) {
            map.set(r.id, row);
            row++;
          }
        }
        continue;
      }

      // Default: one group per property
      if (propRoomsAll.length === 0) continue;
      row++; // property header row
      groups.push({
        key: p.id,
        title: p.name,
        property: p,
        rooms: propRoomsAll,
      });
      for (const r of propRoomsAll) {
        map.set(r.id, row);
        row++;
      }
    }

    return { roomGroups: groups, roomRowMap: map, totalRows: row - 1 };
  }, [properties, rooms]);

  const colForDate = (date: Date) => {
    const diff = differenceInCalendarDays(date, start);
    return Math.max(0, Math.min(days, diff)) + 2; // +2: col 1 is label, +1 to convert to 1-based grid
  };

  const density = (() => {
    if (days <= 7) return "comfortable" as const;
    if (days >= 31) return "compact" as const;
    return "standard" as const;
  })();

  return (
    <div
      className={clsx(
        "max-w-full min-w-0 overflow-auto bg-white shadow-sm",
        // Constrain height so vertical scrolling happens INSIDE the calendar.
        // This makes property/date headers sticky against the calendar's own scroll
        // — they remain visible while scrolling through rooms.
        // Mobile reserves: site header(56) + page title(~80) + bottom nav(~90) + padding(~16) ≈ 240px
        // Desktop reserves: site header(56) + page title(~80) + padding(~16) ≈ 160px
        "max-h-[calc(100dvh-240px)] sm:max-h-[calc(100dvh-160px)]",
        // Mobile base grid
        "[--cal-cell:52px] [--cal-header:36px] [--cal-label:160px] [--cal-row:40px] [--cal-prop-header:44px]",
        // Range-based density tuning (7d: bigger, 31d: tighter)
        density === "comfortable" &&
          "[--cal-cell:64px] [--cal-label:170px] [--cal-row:44px]",
        density === "compact" &&
          "[--cal-cell:44px] [--cal-label:140px] [--cal-row:36px] [--cal-header:32px]",
        "sm:rounded-md sm:border sm:border-neutral-200",
        // Desktop base grid
        "sm:[--cal-cell:88px] sm:[--cal-header:48px] sm:[--cal-label:200px] sm:[--cal-row:52px] sm:[--cal-prop-header:44px]",
        density === "comfortable" &&
          "sm:[--cal-cell:112px] sm:[--cal-label:240px] sm:[--cal-row:60px]",
        density === "compact" &&
          "sm:[--cal-cell:64px] sm:[--cal-label:180px] sm:[--cal-row:44px] sm:[--cal-header:40px]",
      )}
      style={{ overscrollBehaviorX: "contain", overscrollBehaviorY: "auto" }}
    >
      {moveError ? (
        <div
          className="border-b border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800 sm:text-sm"
          role="alert"
        >
          {moveError}
          <button
            type="button"
            className="ml-2 underline"
            onClick={() => setMoveError(null)}
          >
            閉じる
          </button>
        </div>
      ) : null}
      {draggingReservationId ? (
        <div className="border-b border-sky-200 bg-sky-50 px-3 py-1.5 text-[11px] text-sky-900 sm:text-xs">
          移動先の部屋の行にドロップしてください（日付は変わりません）
          {movePending ? " …保存中" : ""}
        </div>
      ) : null}
      <div
        className="relative grid"
        style={{
          gridTemplateColumns: `var(--cal-label) repeat(${days}, var(--cal-cell))`,
          gridTemplateRows: `var(--cal-header)`,
          width: `calc(var(--cal-label) + var(--cal-cell) * ${days})`,
        }}
      >
        {/* Top-left corner */}
        <div
          className="sticky top-0 left-0 z-30 flex items-center border-b border-r border-neutral-200 bg-neutral-50 px-2 text-[11px] font-medium text-neutral-600 sm:px-3 sm:text-xs"
          style={{ gridRow: 1, gridColumn: 1 }}
        >
          部屋
        </div>

        {/* Date header */}
        {dates.map((d, i) => {
          const isToday = isSameDay(d, today);
          const dayOfWeek = d.getDay();
          return (
            <div
              key={d.toISOString()}
              className={clsx(
                "sticky top-0 z-20 flex flex-col items-center justify-center border-b border-r border-neutral-200 text-[11px] leading-tight sm:text-xs sm:leading-normal",
                isToday
                  ? "bg-amber-50 font-semibold text-amber-900"
                  : "bg-neutral-50",
                dayOfWeek === 0 && !isToday && "text-red-600",
                dayOfWeek === 6 && !isToday && "text-blue-600",
              )}
              style={{ gridRow: 1, gridColumn: i + 2 }}
            >
              <span>{format(d, "M/d", { locale: ja })}</span>
              {density !== "compact" ? (
                <span className="text-[9px] text-neutral-500 sm:text-[10px]">
                  {format(d, "EEE", { locale: ja })}
                </span>
              ) : null}
            </div>
          );
        })}

        {/* Property + room rows */}
        {roomGroups.map((g) => {
          const propHeaderRow = roomRowMap.get(g.rooms[0]?.id ?? "")
            ? roomRowMap.get(g.rooms[0]!.id)! - 1
            : null;
          return (
            <PropertyGroup
              key={g.key}
              title={g.title}
              property={g.property}
              rooms={g.rooms}
              dates={dates}
              today={today}
              roomRowMap={roomRowMap}
              propHeaderRow={propHeaderRow}
              onCellClick={openNewModal}
              draggingReservationId={draggingReservationId}
              dropTargetRoomId={dropTargetRoomId}
              onDropTargetRoomChange={setDropTargetRoomId}
              onReservationDrop={handleReservationDrop}
            />
          );
        })}

        {/* Filler rows so the grid takes the right total height (set via gridTemplateRows below) */}
        <div
          style={{
            gridRow: `2 / ${totalRows + 2}`,
            gridColumn: `1 / ${days + 2}`,
            display: "none",
          }}
        />

        {/* Reservation blocks */}
        {reservations.map((r) => {
          if (!r.room_id) return null;
          const row = roomRowMap.get(r.room_id);
          if (!row) return null;
          const checkIn = new Date(`${r.check_in_date}T00:00:00`);
          const checkOut = new Date(`${r.check_out_date}T00:00:00`);
          const startCol = colForDate(checkIn);
          // チェックアウト日の列は含めない（その日の朝までの滞在）。翌ゲストと同日CI/COで列が被らないようにする。
          const endCol = colForDate(checkOut);
          if (endCol <= startCol) return null;

          return (
            <ReservationBlock
              key={r.id}
              reservation={r}
              gridRow={row}
              gridColumnStart={startCol}
              gridColumnEnd={endCol}
              isDragging={draggingReservationId === r.id}
              draggable={
                r.status !== "cancelled" && !!r.room_id && !movePending
              }
              onDragStart={() => {
                dragMovedRef.current = false;
                setMoveError(null);
                setDraggingReservationId(r.id);
              }}
              onDragMove={() => {
                dragMovedRef.current = true;
              }}
              onDragEnd={() => {
                setDraggingReservationId(null);
                setDropTargetRoomId(null);
              }}
              onClick={() => {
                if (dragMovedRef.current) {
                  dragMovedRef.current = false;
                  return;
                }
                openViewModal(r);
              }}
            />
          );
        })}
      </div>

      <ReservationModal
        state={modalState}
        onClose={closeModal}
        properties={properties}
        rooms={rooms}
      />
    </div>
  );
}

function PropertyGroup({
  title,
  property,
  rooms,
  dates,
  today,
  roomRowMap,
  propHeaderRow,
  onCellClick,
  draggingReservationId,
  dropTargetRoomId,
  onDropTargetRoomChange,
  onReservationDrop,
}: {
  title: string;
  property: Property;
  rooms: Room[];
  dates: Date[];
  today: Date;
  roomRowMap: Map<string, number>;
  propHeaderRow: number | null;
  onCellClick: (roomId: string, date: Date) => void;
  draggingReservationId: string | null;
  dropTargetRoomId: string | null;
  onDropTargetRoomChange: (roomId: string | null) => void;
  onReservationDrop: (reservationId: string, targetRoomId: string) => void;
}) {
  if (rooms.length === 0 || propHeaderRow === null) return null;

  return (
    <>
      {/* Label column only — spans entire grid breaks sticky left when scrolled horizontally */}
      <div
        className="sticky left-0 z-20 flex items-center border-b border-r border-neutral-200 bg-neutral-100 px-2 text-[11px] font-semibold text-neutral-700 sm:px-3 sm:text-sm sm:uppercase sm:tracking-wide"
        style={{
          top: "var(--cal-header)",
          gridRow: propHeaderRow,
          gridColumn: 1,
          height: "var(--cal-prop-header)",
        }}
      >
        <div className="min-w-0 leading-tight">
          <div className="whitespace-normal break-words">
            {title}
          </div>
          <div className="mt-0.5 text-[9px] font-normal normal-case text-neutral-500 sm:text-[10px]">
            {rooms.length}部屋
          </div>
        </div>
      </div>
      {dates.map((d, i) => (
        <div
          key={`${property.id}-${format(d, "yyyy-MM-dd")}`}
          className="border-b border-r border-neutral-200 bg-neutral-100"
          style={{
            gridRow: propHeaderRow,
            gridColumn: i + 2,
            height: "var(--cal-prop-header)",
          }}
          aria-hidden
        />
      ))}

      {/* Room rows */}
      {rooms.map((room) => {
        const row = roomRowMap.get(room.id)!;
        return (
          <RoomRow
            key={room.id}
            room={room}
            row={row}
            dates={dates}
            today={today}
            onCellClick={(date) => onCellClick(room.id, date)}
            isDropTarget={
              !!draggingReservationId && dropTargetRoomId === room.id
            }
            onDragEnter={() => {
              if (draggingReservationId) onDropTargetRoomChange(room.id);
            }}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                if (dropTargetRoomId === room.id) onDropTargetRoomChange(null);
              }
            }}
            onDragOver={(e) => {
              if (!draggingReservationId) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = "move";
            }}
            onDrop={(e) => {
              e.preventDefault();
              const id =
                e.dataTransfer.getData("application/x-reservation-id") ||
                draggingReservationId;
              if (id) onReservationDrop(id, room.id);
              onDropTargetRoomChange(null);
            }}
          />
        );
      })}
    </>
  );
}

function RoomRow({
  room,
  row,
  dates,
  today,
  onCellClick,
  isDropTarget,
  onDragEnter,
  onDragLeave,
  onDragOver,
  onDrop,
}: {
  room: Room;
  row: number;
  dates: Date[];
  today: Date;
  onCellClick: (date: Date) => void;
  isDropTarget: boolean;
  onDragEnter: () => void;
  onDragLeave: (e: DragEvent) => void;
  onDragOver: (e: DragEvent) => void;
  onDrop: (e: DragEvent) => void;
}) {
  const typeBadgeCls = (() => {
    switch (room.room_type) {
      case "family":
        return "bg-amber-100 text-amber-900";
      case "single":
        return "bg-sky-100 text-sky-900";
      case "washitsu_modern_4":
        return "bg-violet-100 text-violet-900";
      case "washitsu_modern_3":
        return "bg-fuchsia-100 text-fuchsia-900";
      case "standard":
      default:
        return "bg-neutral-100 text-neutral-700";
    }
  })();

  return (
    <>
      {/* Room label (sticky left) — drop zone for room moves */}
      <div
        className={clsx(
          "sticky left-0 z-[15] flex flex-col justify-center border-b border-r border-neutral-200 px-1.5 sm:px-3",
          isDropTarget ? "bg-sky-100 ring-2 ring-inset ring-sky-400" : "bg-white",
        )}
        style={{ gridRow: row, gridColumn: 1, height: "var(--cal-row)" }}
        onDragEnter={onDragEnter}
        onDragLeave={onDragLeave}
        onDragOver={onDragOver}
        onDrop={onDrop}
      >
        <div className="text-xs font-medium leading-tight sm:text-sm">
          {room.room_number}
        </div>
        <div className="mt-0.5">
          <span
            className={clsx(
              "inline-flex items-center rounded px-1 py-0.5 text-[9px] font-medium leading-none sm:text-[10px]",
              typeBadgeCls,
            )}
          >
            {roomTypeLabel(room.room_type)}
          </span>
        </div>
      </div>

      {/* Empty date cells (background grid, clickable to create new reservation) */}
      {dates.map((d, i) => {
        const dayOfWeek = d.getDay();
        const isToday = isSameDay(d, today);
        return (
          <button
            type="button"
            key={d.toISOString()}
            onClick={() => onCellClick(d)}
            onDragEnter={onDragEnter}
            onDragLeave={onDragLeave}
            onDragOver={onDragOver}
            onDrop={onDrop}
            className={clsx(
              "border-b border-r border-neutral-200 transition hover:bg-neutral-100/50",
              isDropTarget && "bg-sky-100/80 ring-2 ring-inset ring-sky-400",
              isToday && !isDropTarget && "bg-amber-50/60",
              !isToday && dayOfWeek === 0 && !isDropTarget && "bg-red-50/40",
              !isToday && dayOfWeek === 6 && !isDropTarget && "bg-blue-50/40",
            )}
            style={{ gridRow: row, gridColumn: i + 2, height: "var(--cal-row)" }}
            aria-label={`${room.room_number} ${format(d, "M/d")} 新規予約`}
          />
        );
      })}
    </>
  );
}

function ReservationBlock({
  reservation,
  gridRow,
  gridColumnStart,
  gridColumnEnd,
  isDragging,
  draggable,
  onDragStart,
  onDragMove,
  onDragEnd,
  onClick,
}: {
  reservation: Reservation;
  gridRow: number;
  gridColumnStart: number;
  gridColumnEnd: number;
  isDragging: boolean;
  draggable: boolean;
  onDragStart: () => void;
  onDragMove: () => void;
  onDragEnd: () => void;
  onClick: () => void;
}) {
  const { color, border } = colorForStatus(reservation.status);
  const isOnsite = reservation.payment_method === "onsite";
  const hasNotes = !!reservation.special_notes?.trim();

  return (
    <button
      type="button"
      draggable={draggable}
      onDragStart={(e) => {
        e.dataTransfer.setData(
          "application/x-reservation-id",
          reservation.id,
        );
        e.dataTransfer.effectAllowed = "move";
        onDragStart();
      }}
      onDrag={onDragMove}
      onDragEnd={onDragEnd}
      onClick={onClick}
      className={clsx(
        "z-10 flex cursor-grab items-center gap-1 overflow-hidden rounded px-1.5 py-0.5 text-left text-[10px] shadow-sm transition active:cursor-grabbing sm:m-1 sm:gap-1.5 sm:rounded-md sm:px-2 sm:py-1 sm:text-xs",
        "hover:shadow-md sm:hover:scale-[1.01]",
        !draggable && "cursor-pointer",
        isDragging && "opacity-40 ring-2 ring-sky-400",
        color,
        border,
        "border",
      )}
      style={{
        gridRow,
        gridColumnStart,
        gridColumnEnd,
      }}
      title={tooltipText(reservation)}
    >
      {isOnsite ? (
        <span className="rounded bg-orange-200 px-0.5 text-[8px] font-semibold text-orange-900 sm:px-1 sm:text-[9px]">
          現
        </span>
      ) : null}
      {reservation.source === "stripe_web" ? (
        <span className="rounded bg-indigo-200 px-0.5 text-[8px] font-semibold text-indigo-950 sm:px-1 sm:text-[9px]">
          Web
        </span>
      ) : reservation.source === "rakuten_oyado" ? (
        <span className="rounded bg-rose-200 px-0.5 text-[8px] font-semibold text-rose-950 sm:px-1 sm:text-[9px]">
          楽天
        </span>
      ) : null}
      {hasNotes ? (
        <span className="rounded bg-red-200 px-0.5 text-[8px] font-semibold text-red-900 sm:px-1 sm:text-[9px]">
          !
        </span>
      ) : null}
      <span className="min-w-0 truncate font-medium">{reservation.guest_name}</span>
      <span className="ml-auto shrink-0 whitespace-nowrap text-[9px] text-neutral-600 sm:text-[10px]">
        {reservation.guest_count}名
      </span>
    </button>
  );
}

function colorForStatus(status: ReservationStatus): {
  color: string;
  border: string;
} {
  switch (status) {
    case "confirmed":
      return { color: "bg-sky-100 text-sky-900", border: "border-sky-300" };
    case "checked_in":
      return {
        color: "bg-emerald-100 text-emerald-900",
        border: "border-emerald-300",
      };
    case "checked_out":
      return {
        color: "bg-neutral-100 text-neutral-600",
        border: "border-neutral-300",
      };
    case "cancelled":
      return {
        color: "bg-red-50 text-red-600 line-through",
        border: "border-red-200",
      };
    case "blocked":
      return {
        color: "bg-violet-100 text-violet-900",
        border: "border-violet-300",
      };
  }
}

function tooltipText(r: Reservation) {
  const parts = [
    `${r.guest_name} (${r.guest_count}名)`,
    `${r.check_in_date} ${r.check_in_time?.slice(0, 5) ?? ""} → ${r.check_out_date} ${r.check_out_time?.slice(0, 5) ?? ""}`,
    `決済: ${r.payment_method === "onsite" ? "現地" : "オンライン"}`,
  ];
  if (r.status === "blocked") parts.push("楽天ICSブロック（Web在庫対象外）");
  if (r.source === "stripe_web") parts.push("予約元: 公式Web（Stripe）");
  else if (r.source === "rakuten_oyado") parts.push("予約元: 楽天");
  if (r.smart_key_code) parts.push(`鍵: ${r.smart_key_code}`);
  if (r.special_notes) parts.push(`備考: ${r.special_notes}`);
  return parts.join("\n");
}
