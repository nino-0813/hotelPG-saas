import { addDays, format, parseISO } from "date-fns";
import { dateInStayRange } from "@/lib/availability/public-availability";

/**
 * 楽天「手動在庫」運用の補助:
 * 各 (施設 × 部屋タイプ) について、日付ごとに「楽天へ手で入れるべき在庫数」を出す。
 *
 *   楽天在庫 = その部屋タイプの物理部屋数 − その日の有効予約数（出どころ問わず）
 *
 * 出どころ（楽天 / 現地 manual / Web Stripe）は区別せず、物理的に部屋を消費する予約はすべて差し引く。
 * これにより SaaS が唯一の台帳となり、ダブルブッキングを防ぐ。
 */

/** 物理部屋を塞ぐ＝楽天で売ってはいけない予約ステータス（cancelled / checked_out は除外）。 */
export function countsTowardRakutenBlock(status: string): boolean {
  return (
    status === "confirmed" || status === "checked_in" || status === "blocked"
  );
}

export type RakutenInventoryRoomRow = {
  id: string;
  property_id: string;
  room_type: string;
};

export type RakutenInventoryReservationRow = {
  room_id: string | null;
  requested_property_id: string | null;
  requested_room_type: string | null;
  check_in_date: string;
  check_out_date: string;
  status: string;
};

export type RakutenInventoryCell = {
  date: string;
  /** 楽天へ入れるべき在庫数（= 物理部屋数 − 予約数, 下限0） */
  sellable: number;
  /** その日に塞がっている部屋数（内訳表示用） */
  booked: number;
  /** その部屋タイプの物理部屋数 */
  totalRooms: number;
};

export type RakutenInventoryGroup = {
  propertyId: string;
  roomType: string;
  totalRooms: number;
  cells: RakutenInventoryCell[];
};

export type RakutenInventoryResult = {
  start: string;
  days: number;
  dates: string[];
  groups: RakutenInventoryGroup[];
};

/**
 * 日付ごとの楽天向け手動在庫を計算する。PII は一切含めない（件数のみ）。
 */
export function computeRakutenInventoryByDate(
  startDate: string,
  days: number,
  rooms: RakutenInventoryRoomRow[],
  reservations: RakutenInventoryReservationRow[],
): RakutenInventoryResult {
  const start = parseISO(`${startDate}T00:00:00`);
  const dates: string[] = [];
  for (let i = 0; i < days; i++) {
    dates.push(format(addDays(start, i), "yyyy-MM-dd"));
  }

  // (property_id|room_type) -> 物理部屋数 / 部屋ID集合
  const totalByKey = new Map<string, number>();
  const roomIdToKey = new Map<string, string>();
  for (const r of rooms) {
    const key = `${r.property_id}|${r.room_type}`;
    totalByKey.set(key, (totalByKey.get(key) ?? 0) + 1);
    roomIdToKey.set(r.id, key);
  }

  const active = reservations.filter((res) =>
    countsTowardRakutenBlock(res.status),
  );

  const groups: RakutenInventoryGroup[] = [];
  for (const [key, totalRooms] of totalByKey) {
    const pipe = key.indexOf("|");
    const propertyId = key.slice(0, pipe);
    const roomType = key.slice(pipe + 1);

    const cells: RakutenInventoryCell[] = dates.map((d) => {
      // 割当済み：その部屋タイプの物理部屋が塞がっている数（部屋ID単位で重複排除）
      const occupiedRoomIds = new Set<string>();
      // 未割当：requested_property_id + requested_room_type が一致するもの
      let unassigned = 0;

      for (const res of active) {
        if (!dateInStayRange(d, res.check_in_date, res.check_out_date)) continue;
        if (res.room_id) {
          if (roomIdToKey.get(res.room_id) === key) {
            occupiedRoomIds.add(res.room_id);
          }
          continue;
        }
        if (
          res.requested_property_id === propertyId &&
          res.requested_room_type === roomType
        ) {
          unassigned += 1;
        }
      }

      const booked = occupiedRoomIds.size + unassigned;
      const sellable = Math.max(0, totalRooms - booked);
      return { date: d, sellable, booked, totalRooms };
    });

    groups.push({ propertyId, roomType, totalRooms, cells });
  }

  return { start: startDate, days, dates, groups };
}
