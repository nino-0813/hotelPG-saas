import type { RoomType } from "@/lib/types/database";

/** UI labels for DB room_type / requested_room_type / target_room_type */
export const ROOM_TYPE_LABEL: Record<RoomType, string> = {
  standard: "スタンダード",
  family: "ファミリー",
  single: "シングル",
  washitsu_modern_4: "和モダン（最大4名）",
  washitsu_modern_3: "和モダン（最大3名）",
  maisonette_6: "メゾネット洋室（最大6名）",
};

/** Options order in external-calendar「部屋タイプ」select */
export const ROOM_TYPES_ORDERED: RoomType[] = [
  "standard",
  "family",
  "single",
  "washitsu_modern_4",
  "washitsu_modern_3",
  "maisonette_6",
];

export function roomTypeLabel(type: RoomType): string {
  return ROOM_TYPE_LABEL[type] ?? type;
}
