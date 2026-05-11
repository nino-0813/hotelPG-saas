/**
 * Published list prices for the public availability API.
 * Separated for a future move to e.g. `room_rates` in the database.
 */

export type PublicRateBand = {
  weekday: number;
  friday: number;
  saturday: number;
};

/** Per-guest surcharge (yen/night) from the 3rd guest onward (PG2 family, PG3). */
export const EXTRA_PER_GUEST_FROM_THIRD = 5200;

/** property `code` (e.g. PG1) → room_type → nightly base rates (yen), before guest surcharges. */
export const RATE_RULES: Record<string, Record<string, PublicRateBand>> = {
  PG1: {
    standard: {
      weekday: 8000,
      friday: 8000,
      saturday: 8000,
    },
  },
  PG2: {
    single: {
      weekday: 8000,
      friday: 12000,
      saturday: 12000,
    },
    family: {
      weekday: 14500,
      friday: 18500,
      saturday: 18500,
    },
  },
};

export type TokyoDayKind = "weekday" | "friday" | "saturday";

/** Calendar date `YYYY-MM-DD` interpreted in Asia/Tokyo (hotel is in Japan). */
export function getTokyoDayKind(dateYmd: string): TokyoDayKind {
  const inst = new Date(`${dateYmd}T12:00:00+09:00`);
  const short = inst.toLocaleDateString("en-US", {
    timeZone: "Asia/Tokyo",
    weekday: "short",
  });
  if (short === "Fri") return "friday";
  if (short === "Sat") return "saturday";
  return "weekday";
}

function isWeekendKind(kind: TokyoDayKind): boolean {
  return kind === "friday" || kind === "saturday";
}

/** PG-III DB uses washitsu_modern_*; web may send family/standard as aliases. */
export function isPg3PricedRoomTypeAlias(roomType: string): boolean {
  const n = roomType.toLowerCase();
  return (
    n === "family" ||
    n === "standard" ||
    roomType === "washitsu_modern_4" ||
    roomType === "washitsu_modern_3"
  );
}

/**
 * When the site passes family/standard for PG3, inventory should match actual DB room_type values.
 */
export function resolvePg3RoomTypesForFilter(roomTypeParam: string): string[] {
  const v = roomTypeParam.toLowerCase();
  if (v === "family" || v === "standard") {
    return ["washitsu_modern_4", "washitsu_modern_3"];
  }
  return [roomTypeParam];
}

/** PG-III: base covers 1–2 guests; each guest from the 3rd adds EXTRA_PER_GUEST_FROM_THIRD (max occupancy is per room, not a price tier). */
function pg3ListPriceForNight(
  dateYmd: string,
  guestCount: number,
): number {
  const kind = getTokyoDayKind(dateYmd);
  const weekend = isWeekendKind(kind);
  const base = weekend ? 26500 : 22500;
  const guests = Math.max(1, guestCount);
  const extraGuests = Math.max(0, guests - 2);
  return base + extraGuests * EXTRA_PER_GUEST_FROM_THIRD;
}

function pg2FamilyListPriceForNight(dateYmd: string, guestCount: number): number {
  const band = RATE_RULES.PG2?.family;
  if (!band) return 0;
  const kind = getTokyoDayKind(dateYmd);
  const base = band[kind];
  const guests = Math.max(1, guestCount);
  const extraGuests = Math.max(0, guests - 2);
  return base + extraGuests * EXTRA_PER_GUEST_FROM_THIRD;
}

/**
 * Published list price for one night (yen), or null if no rule applies.
 * `guestCount` = adults + children from the public API.
 */
export function computeListPriceForNight(
  propertyCode: string,
  roomType: string,
  dateYmd: string,
  guestCount: number,
): number | null {
  if (propertyCode === "PG3" && isPg3PricedRoomTypeAlias(roomType)) {
    return pg3ListPriceForNight(dateYmd, guestCount);
  }

  if (propertyCode === "PG2" && roomType === "family") {
    return pg2FamilyListPriceForNight(dateYmd, guestCount);
  }

  const band = RATE_RULES[propertyCode]?.[roomType];
  if (!band) return null;
  const kind = getTokyoDayKind(dateYmd);
  return band[kind];
}

/** @deprecated Use computeListPriceForNight with explicit guestCount. */
export function getListPriceForDate(
  propertyCode: string,
  roomType: string,
  dateYmd: string,
): number | null {
  return computeListPriceForNight(propertyCode, roomType, dateYmd, 2);
}

export function hasListPriceRule(
  propertyCode: string,
  roomType: string,
): boolean {
  if (propertyCode === "PG3" && isPg3PricedRoomTypeAlias(roomType)) {
    return true;
  }
  return RATE_RULES[propertyCode]?.[roomType] != null;
}
