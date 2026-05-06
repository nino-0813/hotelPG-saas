"use client";

import { addDays, differenceInCalendarDays, format, isSameDay } from "date-fns";
import { ja } from "date-fns/locale";
import { useMemo, useState } from "react";
import clsx from "clsx";
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
  const start = useMemo(() => new Date(startDate), [startDate]);
  const [modalState, setModalState] = useState<ModalState>({ mode: "closed" });

  const openNewModal = (roomId: string, date: Date) => {
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

  const dates = useMemo(
    () => Array.from({ length: days }, (_, i) => addDays(start, i)),
    [start, days],
  );

  const today = useMemo(() => {
    const t = new Date();
    t.setHours(0, 0, 0, 0);
    return t;
  }, []);

  // Build grid row map: room id -> grid row index (1-based, accounting for date header & property headers)
  const { roomRowMap, totalRows } = useMemo(() => {
    const map = new Map<string, number>();
    let row = 2; // row 1 = date header
    for (const p of properties) {
      row++; // property header row
      const propRooms = rooms
        .filter((r) => r.property_id === p.id)
        .sort((a, b) => a.display_order - b.display_order);
      for (const r of propRooms) {
        map.set(r.id, row);
        row++;
      }
    }
    return { roomRowMap: map, totalRows: row - 1 };
  }, [properties, rooms]);

  const colForDate = (date: Date) => {
    const diff = differenceInCalendarDays(date, start);
    return Math.max(0, Math.min(days, diff)) + 2; // +2: col 1 is label, +1 to convert to 1-based grid
  };

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
        // Mobile: compact grid / rows so more fits on screen; sm: desktop sizes.
        "[--cal-cell:52px] [--cal-header:36px] [--cal-label:78px] [--cal-row:40px] [--cal-prop-header:26px]",
        "sm:rounded-md sm:border sm:border-neutral-200",
        "sm:[--cal-cell:88px] sm:[--cal-header:48px] sm:[--cal-label:200px] sm:[--cal-row:52px] sm:[--cal-prop-header:32px]",
      )}
      style={{ overscrollBehaviorX: "contain", overscrollBehaviorY: "auto" }}
    >
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
              <span className="text-[9px] text-neutral-500 sm:text-[10px]">
                {format(d, "EEE", { locale: ja })}
              </span>
            </div>
          );
        })}

        {/* Property + room rows */}
        {properties.map((p) => {
          const propRooms = rooms
            .filter((r) => r.property_id === p.id)
            .sort((a, b) => a.display_order - b.display_order);

          const propHeaderRow = roomRowMap.get(propRooms[0]?.id ?? "")
            ? roomRowMap.get(propRooms[0]!.id)! - 1
            : null;

          return (
            <PropertyGroup
              key={p.id}
              property={p}
              rooms={propRooms}
              dates={dates}
              today={today}
              roomRowMap={roomRowMap}
              propHeaderRow={propHeaderRow}
              onCellClick={openNewModal}
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
          const endCol = colForDate(checkOut) + 1; // +1 because grid-column-end is exclusive
          if (endCol <= startCol) return null;

          return (
            <ReservationBlock
              key={r.id}
              reservation={r}
              gridRow={row}
              gridColumnStart={startCol}
              gridColumnEnd={endCol}
              onClick={() => openViewModal(r)}
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
  property,
  rooms,
  dates,
  today,
  roomRowMap,
  propHeaderRow,
  onCellClick,
}: {
  property: Property;
  rooms: Room[];
  dates: Date[];
  today: Date;
  roomRowMap: Map<string, number>;
  propHeaderRow: number | null;
  onCellClick: (roomId: string, date: Date) => void;
}) {
  if (rooms.length === 0 || propHeaderRow === null) return null;

  return (
    <>
      {/* Label column only — spans entire grid breaks sticky left when scrolled horizontally */}
      <div
        className="sticky left-0 z-20 flex items-center border-b border-r border-neutral-200 bg-neutral-100 px-2 text-[11px] font-semibold uppercase tracking-wide text-neutral-700 sm:px-3 sm:text-xs"
        style={{
          top: "var(--cal-header)",
          gridRow: propHeaderRow,
          gridColumn: 1,
          height: "var(--cal-prop-header)",
        }}
      >
        {property.name}
        <span className="ml-1.5 text-[9px] font-normal normal-case text-neutral-500 sm:ml-2 sm:text-[10px]">
          {rooms.length}部屋
        </span>
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
}: {
  room: Room;
  row: number;
  dates: Date[];
  today: Date;
  onCellClick: (date: Date) => void;
}) {
  return (
    <>
      {/* Room label (sticky left) */}
      <div
        className="sticky left-0 z-[15] flex flex-col justify-center border-b border-r border-neutral-200 bg-white px-1.5 sm:px-3"
        style={{ gridRow: row, gridColumn: 1, height: "var(--cal-row)" }}
      >
        <div className="text-xs font-medium leading-tight sm:text-sm">
          {room.room_number}
        </div>
        <div className="text-[9px] leading-tight text-neutral-500 sm:text-[10px]">
          {roomTypeLabel(room.room_type)}
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
            className={clsx(
              "border-b border-r border-neutral-200 transition hover:bg-neutral-100/50",
              isToday && "bg-amber-50/60",
              !isToday && dayOfWeek === 0 && "bg-red-50/40",
              !isToday && dayOfWeek === 6 && "bg-blue-50/40",
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
  onClick,
}: {
  reservation: Reservation;
  gridRow: number;
  gridColumnStart: number;
  gridColumnEnd: number;
  onClick: () => void;
}) {
  const { color, border } = colorForStatus(reservation.status);
  const isOnsite = reservation.payment_method === "onsite";
  const hasNotes = !!reservation.special_notes?.trim();

  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        "z-10 flex cursor-pointer items-center gap-1 overflow-hidden rounded px-1.5 py-0.5 text-left text-[10px] shadow-sm transition sm:m-1 sm:gap-1.5 sm:rounded-md sm:px-2 sm:py-1 sm:text-xs",
        "hover:shadow-md sm:hover:scale-[1.01]",
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
  }
}

function tooltipText(r: Reservation) {
  const parts = [
    `${r.guest_name} (${r.guest_count}名)`,
    `${r.check_in_date} ${r.check_in_time?.slice(0, 5) ?? ""} → ${r.check_out_date} ${r.check_out_time?.slice(0, 5) ?? ""}`,
    `決済: ${r.payment_method === "onsite" ? "現地" : "オンライン"}`,
  ];
  if (r.smart_key_code) parts.push(`鍵: ${r.smart_key_code}`);
  if (r.special_notes) parts.push(`備考: ${r.special_notes}`);
  return parts.join("\n");
}
