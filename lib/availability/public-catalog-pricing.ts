import { listPriceFromRoomSetting } from "@/lib/availability/list-price-from-db-setting";
import {
  computeListPriceForNight,
  getTokyoDayKind,
  hasListPriceRule,
} from "@/lib/availability/public-rate-rules";
import {
  listPriceFromGuestRuleRow,
  pickBestGuestPriceRule,
} from "@/lib/availability/guest-price-rules";
import { pickBestSeasonalRateForDate } from "@/lib/availability/seasonal-room-rates";
import type {
  PublicGuestPriceRuleRow,
  PublicRoomSettingRow,
  PublicSeasonalRoomRateRow,
} from "@/lib/types/public-catalog";

/** One-night list from a seasonal row; null `included_guests` / `extra_guest_fee` fall back to base setting or defaults. */
export function listPriceFromSeasonalRow(
  seasonal: PublicSeasonalRoomRateRow,
  base: PublicRoomSettingRow | null,
  dateYmd: string,
  guestCount: number,
): number {
  const kind = getTokyoDayKind(dateYmd);
  const basePrice =
    kind === "friday"
      ? seasonal.friday_price
      : kind === "saturday"
        ? seasonal.saturday_price
        : seasonal.weekday_price;
  const included =
    seasonal.included_guests ??
    (base && base.is_active ? base.included_guests : null) ??
    2;
  const extraFee =
    seasonal.extra_guest_fee ??
    (base && base.is_active ? base.extra_guest_fee : null) ??
    0;
  const g = Math.max(1, guestCount);
  const extraSlots = Math.max(0, g - included);
  return basePrice + extraSlots * extraFee;
}

/**
 * Shared nightly list price for public availability and Stripe checkout.
 * Priority: seasonal → guest-band rules → public_room_settings → hardcoded rules.
 */
export function buildPublicListPriceForDate(params: {
  propertyCode: string;
  roomType: string;
  dbRoomSetting: PublicRoomSettingRow | null;
  seasonalRows: PublicSeasonalRoomRateRow[];
  guestPriceRules: PublicGuestPriceRuleRow[];
}): ((dateYmd: string, guestCount: number) => number | null) | undefined {
  const { propertyCode, roomType, dbRoomSetting, seasonalRows, guestPriceRules } =
    params;
  const hasDbPrice = dbRoomSetting !== null && dbRoomSetting.is_active === true;
  const hasCodePrice = !hasDbPrice && hasListPriceRule(propertyCode, roomType);
  const hasSeasonal = seasonalRows.length > 0;
  const hasGuestPriceRules = guestPriceRules.length > 0;

  if (!hasDbPrice && !hasCodePrice && !hasSeasonal && !hasGuestPriceRules) {
    return undefined;
  }

  return (dateYmd: string, guestCount: number) => {
    const seasonal = pickBestSeasonalRateForDate(seasonalRows, dateYmd);
    if (seasonal) {
      return listPriceFromSeasonalRow(seasonal, dbRoomSetting, dateYmd, guestCount);
    }
    const guestRule = pickBestGuestPriceRule(guestPriceRules, guestCount);
    if (guestRule) {
      return listPriceFromGuestRuleRow(guestRule, dateYmd);
    }
    if (hasDbPrice) {
      return listPriceFromRoomSetting(dbRoomSetting!, dateYmd, guestCount);
    }
    if (hasCodePrice) {
      return computeListPriceForNight(propertyCode, roomType, dateYmd, guestCount);
    }
    return null;
  };
}
