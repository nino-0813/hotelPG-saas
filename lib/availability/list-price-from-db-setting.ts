import { getTokyoDayKind } from "@/lib/availability/public-rate-rules";
import type { PublicRoomSettingRow } from "@/lib/types/public-catalog";

/** One-night list price from DB row (base by Tokyo weekday + extra guests beyond included). */
export function listPriceFromRoomSetting(
  row: PublicRoomSettingRow,
  dateYmd: string,
  guestCount: number,
): number {
  const kind = getTokyoDayKind(dateYmd);
  const base =
    kind === "friday"
      ? row.friday_price
      : kind === "saturday"
        ? row.saturday_price
        : row.weekday_price;
  const g = Math.max(1, guestCount);
  const extraSlots = Math.max(0, g - row.included_guests);
  return base + extraSlots * row.extra_guest_fee;
}
