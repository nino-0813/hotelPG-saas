"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { format } from "date-fns";
import { ja } from "date-fns/locale";
import clsx from "clsx";
import { ROOM_TYPE_LABEL } from "@/lib/room-type-labels";
import type {
  ExternalCalendar,
  Property,
  Reservation,
  Room,
  RoomType,
} from "@/lib/types/database";
import { assignReservationRoom } from "./actions";

type ExternalCalendarRef = Pick<
  ExternalCalendar,
  "id" | "display_name" | "property_id" | "target_room_type"
>;

type Props = {
  pending: Reservation[];
  /** Reservations already assigned to a room — used to detect conflicts. */
  assignedReservations: Reservation[];
  rooms: Room[];
  properties: Property[];
  externalCalendars: ExternalCalendarRef[];
};

export function PendingAssignments({
  pending,
  assignedReservations,
  rooms,
  properties,
  externalCalendars,
}: Props) {
  const [open, setOpen] = useState(false);
  const [expandedSections, setExpandedSections] = useState<Set<string>>(
    () => new Set(),
  );
  const [target, setTarget] = useState<Reservation | null>(null);

  const grouped = useMemo(
    () => buildPendingGroups(pending, properties, externalCalendars),
    [pending, properties, externalCalendars],
  );

  useEffect(() => {
    if (!open) queueMicrotask(() => setExpandedSections(new Set()));
  }, [open]);

  function toggleSection(label: string) {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  }

  if (pending.length === 0) return null;

  return (
    <>
      <div className="mb-4 overflow-hidden rounded-md border border-amber-300 bg-amber-50">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left hover:bg-amber-100/60"
        >
          <span className="flex items-center gap-2 text-sm font-medium text-amber-900">
            ⚠️ 未割当の予約が {pending.length}件あります
          </span>
          <span className="text-xs text-amber-700">
            {open ? "閉じる ▲" : "開く ▼"}
          </span>
        </button>

        {open && (
          <div className="divide-y divide-amber-200 border-t border-amber-200 bg-white">
            {grouped.map(({ label, reservations }) => {
              const sectionOpen = expandedSections.has(label);
              return (
              <section key={label} className="divide-y divide-amber-100">
                <button
                  type="button"
                  onClick={() => toggleSection(label)}
                  className="sticky top-0 z-[1] flex w-full items-start justify-between gap-2 bg-amber-100/90 px-4 py-2 text-left backdrop-blur-sm hover:bg-amber-200/70"
                >
                  <div className="min-w-0">
                    <h3 className="text-xs font-semibold tracking-tight text-amber-950">
                      {label}
                    </h3>
                    <p className="text-[11px] text-amber-800">
                      {reservations.length}件
                    </p>
                  </div>
                  <span className="shrink-0 pt-0.5 text-[11px] text-amber-800">
                    {sectionOpen ? "閉じる ▲" : "開く ▼"}
                  </span>
                </button>
                {sectionOpen &&
                  reservations.map((r) => {
                  const property = properties.find(
                    (p) => p.id === r.requested_property_id,
                  );
                  return (
                    <div
                      key={r.id}
                      className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:gap-4"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-semibold">
                            {r.guest_name}
                          </span>
                          <span className="text-xs text-neutral-500">
                            {r.guest_count}名
                          </span>
                          {(() => {
                            const badgeKey =
                              r.source === "stripe_web"
                                ? "stripe_web"
                                : (r.external_source ?? r.source);
                            return badgeKey ? (
                            <span className="rounded bg-neutral-900 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-white">
                              {sourceLabel(badgeKey)}
                            </span>
                            ) : null;
                          })()}
                          {r.requested_room_type && (
                            <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] font-medium text-neutral-700">
                              {ROOM_TYPE_LABEL[r.requested_room_type] ??
                                r.requested_room_type}
                            </span>
                          )}
                        </div>
                        <div className="mt-1 flex flex-wrap gap-x-3 text-xs text-neutral-600">
                          <span>🏨 {property?.name ?? "?"}</span>
                          <span>
                            📅{" "}
                            {format(
                              new Date(`${r.check_in_date}T00:00:00`),
                              "M/d (EEE)",
                              { locale: ja },
                            )}{" "}
                            →{" "}
                            {format(
                              new Date(`${r.check_out_date}T00:00:00`),
                              "M/d (EEE)",
                              { locale: ja },
                            )}
                          </span>
                        </div>
                        {r.special_notes && (
                          <div className="mt-1 whitespace-pre-line text-[11px] text-neutral-500">
                            {r.special_notes}
                          </div>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => setTarget(r)}
                        className="shrink-0 rounded-md bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-neutral-800"
                      >
                        部屋とキー番号を割り当てる
                      </button>
                    </div>
                  );
                })}
              </section>
              );
            })}
          </div>
        )}
      </div>

      {target && (
        <AssignmentModal
          reservation={target}
          rooms={rooms}
          assignedReservations={assignedReservations}
          properties={properties}
          onClose={() => setTarget(null)}
        />
      )}
    </>
  );
}

function AssignmentModal({
  reservation,
  rooms,
  assignedReservations,
  properties,
  onClose,
}: {
  reservation: Reservation;
  rooms: Room[];
  assignedReservations: Reservation[];
  properties: Property[];
  onClose: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [selectedRoomId, setSelectedRoomId] = useState<string>("");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  const property = properties.find(
    (p) => p.id === reservation.requested_property_id,
  );

  const eligibleRooms = useMemo(() => {
    return rooms
      .filter(
        (r) =>
          r.property_id === reservation.requested_property_id &&
          (!reservation.requested_room_type ||
            r.room_type === reservation.requested_room_type),
      )
      .sort((a, b) => a.display_order - b.display_order);
  }, [rooms, reservation]);

  const conflictsByRoom = useMemo(() => {
    const checkIn = reservation.check_in_date;
    const checkOut = reservation.check_out_date;
    const map = new Map<string, Reservation[]>();
    for (const other of assignedReservations) {
      if (!other.room_id) continue;
      if (other.id === reservation.id) continue;
      if (other.status === "cancelled") continue;
      // overlap test: A.start < B.end && B.start < A.end
      if (other.check_in_date < checkOut && checkIn < other.check_out_date) {
        const arr = map.get(other.room_id) ?? [];
        arr.push(other);
        map.set(other.room_id, arr);
      }
    }
    return map;
  }, [assignedReservations, reservation]);

  const handleSubmit = (formData: FormData) => {
    startTransition(async () => {
      setError(null);
      const room_id = String(formData.get("room_id") ?? "");
      if (!room_id) {
        setError("部屋を選択してください");
        return;
      }
      const result = await assignReservationRoom({
        id: reservation.id,
        room_id,
        smart_key_code: String(formData.get("smart_key_code") ?? ""),
        special_notes: String(formData.get("special_notes") ?? ""),
      });
      if (result.error) setError(result.error);
      else onClose();
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex bg-black/40 sm:items-center sm:justify-center sm:px-4 sm:py-8"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="h-full w-full overflow-auto bg-white shadow-xl sm:h-auto sm:max-h-full sm:max-w-2xl sm:rounded-lg">
        <form action={handleSubmit}>
          <div className="sticky top-0 z-10 flex items-start justify-between border-b border-neutral-200 bg-white px-4 py-3.5 sm:px-6 sm:py-4">
            <div>
              <h2 className="text-lg font-semibold tracking-tight">
                部屋とキー番号を割り当てる
              </h2>
              <p className="mt-0.5 text-sm text-neutral-500">
                {reservation.guest_name} ({reservation.guest_count}名) ・{" "}
                {property?.name ?? "?"}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="-m-1 rounded-md p-2 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
            >
              ✕
            </button>
          </div>

          <div className="space-y-4 px-4 py-4 sm:px-6 sm:py-5">
            <div className="rounded-md border border-neutral-200 bg-neutral-50 p-3 text-xs">
              <div className="grid grid-cols-2 gap-x-3 gap-y-1">
                <span className="text-neutral-500">チェックイン</span>
                <span>
                  {reservation.check_in_date}{" "}
                  {reservation.check_in_time?.slice(0, 5)}
                </span>
                <span className="text-neutral-500">チェックアウト</span>
                <span>
                  {reservation.check_out_date}{" "}
                  {reservation.check_out_time?.slice(0, 5)}
                </span>
                {reservation.requested_room_type && (
                  <>
                    <span className="text-neutral-500">部屋タイプ</span>
                    <span>
                      {ROOM_TYPE_LABEL[reservation.requested_room_type] ??
                        reservation.requested_room_type}
                    </span>
                  </>
                )}
                {reservation.external_source && (
                  <>
                    <span className="text-neutral-500">取込元</span>
                    <span>{sourceLabel(reservation.external_source)}</span>
                  </>
                )}
              </div>
            </div>

            <div>
              <span className="mb-2 block text-xs font-medium text-neutral-700">
                部屋を選ぶ <span className="text-red-500">*</span>
              </span>
              {eligibleRooms.length === 0 ? (
                <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
                  対応する部屋タイプの部屋がありません
                </p>
              ) : (
                <div className="space-y-1.5">
                  {eligibleRooms.map((room) => {
                    const conflicts = conflictsByRoom.get(room.id) ?? [];
                    const hasConflict = conflicts.length > 0;
                    const id = `room-${room.id}`;
                    return (
                      <label
                        key={room.id}
                        htmlFor={id}
                        className={clsx(
                          "flex cursor-pointer items-start gap-3 rounded-md border p-3 transition",
                          selectedRoomId === room.id
                            ? "border-neutral-900 bg-neutral-50"
                            : hasConflict
                              ? "border-amber-300 bg-amber-50/40"
                              : "border-neutral-200 bg-white hover:bg-neutral-50",
                        )}
                      >
                        <input
                          id={id}
                          type="radio"
                          name="room_id"
                          value={room.id}
                          checked={selectedRoomId === room.id}
                          onChange={() => setSelectedRoomId(room.id)}
                          className="mt-1"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-semibold">
                              {room.room_number}
                            </span>
                            {!hasConflict ? (
                              <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-800">
                                空き
                              </span>
                            ) : (
                              <span className="rounded bg-amber-200 px-1.5 py-0.5 text-[10px] font-medium text-amber-900">
                                ⚠️ 重複あり
                              </span>
                            )}
                          </div>
                          {hasConflict && (
                            <ul className="mt-1 space-y-0.5 text-[11px] text-amber-900">
                              {conflicts.map((c) => (
                                <li key={c.id}>
                                  {c.guest_name} ({c.check_in_date} →{" "}
                                  {c.check_out_date})
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      </label>
                    );
                  })}
                </div>
              )}
            </div>

            <label className="block">
              <span className="mb-1 block text-xs font-medium text-neutral-700">
                スマートキー番号
              </span>
              <input
                name="smart_key_code"
                placeholder="例: 1234"
                className={inputCls}
                defaultValue={reservation.smart_key_code ?? ""}
              />
            </label>

            <label className="block">
              <span className="mb-1 block text-xs font-medium text-neutral-700">
                特記事項
              </span>
              <textarea
                name="special_notes"
                rows={3}
                defaultValue={reservation.special_notes ?? ""}
                className={inputCls}
              />
            </label>

            {error && (
              <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
                {error}
              </p>
            )}
          </div>

          <div className="sticky bottom-0 flex flex-wrap items-center justify-end gap-2 border-t border-neutral-200 bg-neutral-50 px-4 py-3 sm:px-6">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm font-medium text-neutral-700"
            >
              キャンセル
            </button>
            <button
              type="submit"
              disabled={pending || !selectedRoomId}
              className="rounded-md bg-neutral-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
            >
              {pending ? "確定中..." : "部屋とキー番号を確定"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

const ROOM_TYPE_SORT: Record<RoomType, number> = {
  single: 0,
  standard: 1,
  family: 2,
  washitsu_modern_4: 3,
  washitsu_modern_3: 4,
};

function buildPendingGroups(
  pending: Reservation[],
  properties: Property[],
  externalCalendars: ExternalCalendarRef[],
): { label: string; reservations: Reservation[] }[] {
  const calById = new Map(externalCalendars.map((c) => [c.id, c]));
  const propById = new Map(properties.map((p) => [p.id, p]));

  function sectionLabel(r: Reservation): string {
    if (r.external_calendar_id) {
      const cal = calById.get(r.external_calendar_id);
      const dn = cal?.display_name?.trim();
      if (dn) return dn;
    }
    const prop = r.requested_property_id
      ? propById.get(r.requested_property_id)
      : undefined;
    const pname = prop?.name ?? "物件未設定";
    if (r.requested_room_type) {
      const tl =
        ROOM_TYPE_LABEL[r.requested_room_type] ?? r.requested_room_type;
      return `${pname}・${tl}タイプ`;
    }
    return pname;
  }

  function sortTuple(r: Reservation): [number, number, string] {
    const prop = r.requested_property_id
      ? propById.get(r.requested_property_id)
      : undefined;
    const po = prop?.display_order ?? 999;
    const rt = r.requested_room_type
      ? ROOM_TYPE_SORT[r.requested_room_type]
      : 9;
    return [po, rt, sectionLabel(r)];
  }

  const byLabel = new Map<string, Reservation[]>();
  for (const r of pending) {
    const lab = sectionLabel(r);
    const arr = byLabel.get(lab) ?? [];
    arr.push(r);
    byLabel.set(lab, arr);
  }

  return [...byLabel.entries()]
    .sort((a, b) => {
      const ta = sortTuple(a[1][0]);
      const tb = sortTuple(b[1][0]);
      if (ta[0] !== tb[0]) return ta[0] - tb[0];
      if (ta[1] !== tb[1]) return ta[1] - tb[1];
      return ta[2].localeCompare(tb[2], "ja");
    })
    .map(([label, reservations]) => ({ label, reservations }));
}

function sourceLabel(source: string) {
  const map: Record<string, string> = {
    rakuten_oyado: "楽天",
    stripe_web: "公式Web（Stripe）",
    booking_com: "Booking",
    airbnb: "Airbnb",
  };
  return map[source] ?? source;
}

const inputCls =
  "w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-neutral-900 focus:outline-none";
