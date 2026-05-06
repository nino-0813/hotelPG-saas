import type { RoomType } from "@/lib/types/database";

/** UI labels for DB room_type / requested_room_type / target_room_type */
export const ROOM_TYPE_LABEL: Record<RoomType, string> = {
  standard: "スタンダード",
  family: "ファミリー",
  single: "シングル",
  washitsu_modern_4:
    "【OPEN 記念価格】2 名利用でお得 | 和モダン客室 | 最大 4 名 | セミダブルベッド | 無料駐車場",
  washitsu_modern_3:
    "【OPEN 記念価格】2 名利用でお得 | 和モダン客室 | 最大 3 名 | 無料駐車場 | 長期滞在歓迎",
};

/** Options order in external-calendar「部屋タイプ」select */
export const ROOM_TYPES_ORDERED: RoomType[] = [
  "standard",
  "family",
  "single",
  "washitsu_modern_4",
  "washitsu_modern_3",
];

export function roomTypeLabel(type: RoomType): string {
  return ROOM_TYPE_LABEL[type] ?? type;
}
