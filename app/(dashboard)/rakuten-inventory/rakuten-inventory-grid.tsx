"use client";

import { useMemo } from "react";
import { format, getDay, parseISO } from "date-fns";
import clsx from "clsx";
import type { Property, RoomType } from "@/lib/types/database";
import { roomTypeLabel, ROOM_TYPES_ORDERED } from "@/lib/room-type-labels";
import type { RakutenInventoryResult } from "@/lib/availability/rakuten-inventory";

const WEEKDAY_JA = ["日", "月", "火", "水", "木", "金", "土"];

function dateHeaderClass(dateStr: string): string {
  const dow = getDay(parseISO(`${dateStr}T00:00:00`));
  if (dow === 0) return "text-red-600";
  if (dow === 6) return "text-blue-600";
  return "text-neutral-600";
}

function cellTone(sellable: number, totalRooms: number): string {
  if (totalRooms === 0) return "text-neutral-300";
  if (sellable === 0) return "bg-red-50 text-red-600 font-semibold";
  if (sellable < totalRooms) return "bg-amber-50 text-amber-700 font-semibold";
  return "text-neutral-900 font-semibold";
}

export function RakutenInventoryGrid({
  properties,
  inventory,
}: {
  properties: Property[];
  inventory: RakutenInventoryResult;
}) {
  const orderedGroups = useMemo(() => {
    const propOrder = new Map(properties.map((p, i) => [p.id, i]));
    const propName = new Map(properties.map((p) => [p.id, p.name]));
    const typeOrder = new Map(
      ROOM_TYPES_ORDERED.map((t, i) => [t as string, i]),
    );
    return inventory.groups
      .map((g) => ({
        ...g,
        propertyName: propName.get(g.propertyId) ?? g.propertyId,
      }))
      .sort((a, b) => {
        const pa = propOrder.get(a.propertyId) ?? 999;
        const pb = propOrder.get(b.propertyId) ?? 999;
        if (pa !== pb) return pa - pb;
        const ta = typeOrder.get(a.roomType) ?? 999;
        const tb = typeOrder.get(b.roomType) ?? 999;
        return ta - tb;
      });
  }, [inventory.groups, properties]);

  if (orderedGroups.length === 0) {
    return (
      <div className="px-4 py-8 text-sm text-neutral-500">
        部屋が登録されていません。
      </div>
    );
  }

  return (
    <div className="overflow-x-auto px-4 sm:px-0">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr>
            <th className="sticky left-0 z-10 min-w-[200px] border-b border-r border-neutral-200 bg-white px-3 py-2 text-left font-medium text-neutral-700">
              施設 / 部屋タイプ
            </th>
            {inventory.dates.map((d) => {
              const dt = parseISO(`${d}T00:00:00`);
              return (
                <th
                  key={d}
                  className={clsx(
                    "border-b border-neutral-200 px-1 py-2 text-center font-medium tabular-nums",
                    dateHeaderClass(d),
                  )}
                >
                  <div className="text-xs leading-tight">
                    {format(dt, "M/d")}
                  </div>
                  <div className="text-[10px] leading-tight">
                    {WEEKDAY_JA[getDay(dt)]}
                  </div>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {orderedGroups.map((g) => (
            <tr key={`${g.propertyId}|${g.roomType}`} className="hover:bg-neutral-50/60">
              <th className="sticky left-0 z-10 border-b border-r border-neutral-200 bg-white px-3 py-2 text-left font-normal">
                <div className="text-xs text-neutral-400">{g.propertyName}</div>
                <div className="flex items-center gap-1.5">
                  <span className="font-medium text-neutral-900">
                    {roomTypeLabel(g.roomType as RoomType)}
                  </span>
                  <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] text-neutral-500">
                    全{g.totalRooms}室
                  </span>
                </div>
              </th>
              {g.cells.map((c) => (
                <td
                  key={c.date}
                  title={`${format(parseISO(`${c.date}T00:00:00`), "M/d")} ／ 楽天在庫 ${c.sellable}（全${c.totalRooms}室 − 予約${c.booked}）`}
                  className={clsx(
                    "border-b border-l border-neutral-100 px-1 py-2 text-center tabular-nums",
                    cellTone(c.sellable, c.totalRooms),
                  )}
                >
                  <div className="text-base leading-none">{c.sellable}</div>
                  <div className="mt-0.5 text-[10px] font-normal leading-none text-neutral-400">
                    {c.booked > 0 ? `予${c.booked}` : " "}
                  </div>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 px-4 text-xs text-neutral-500 sm:px-0">
        <span className="font-medium text-neutral-600">凡例:</span>
        <span>大きい数字 = 楽天へ手入力する在庫数</span>
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-3 w-3 rounded bg-amber-50 ring-1 ring-amber-200" />
          一部予約あり
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-3 w-3 rounded bg-red-50 ring-1 ring-red-200" />
          満室（楽天は0/停止）
        </span>
        <span>「予N」= その日に塞がっている室数</span>
      </div>
    </div>
  );
}
