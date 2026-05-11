/**
 * Published list prices for the public availability API.
 * Separated for a future move to e.g. `room_rates` in the database.
 */

export type PublicRateBand = {
  weekday: number;
  friday: number;
  saturday: number;
};

/** property `code` (e.g. PG1) → room_type → nightly rates (yen). */
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

/** List price for a property code + room type on a calendar night, or null if no rule. */
export function getListPriceForDate(
  propertyCode: string,
  roomType: string,
  dateYmd: string,
): number | null {
  const band = RATE_RULES[propertyCode]?.[roomType];
  if (!band) return null;
  const kind = getTokyoDayKind(dateYmd);
  return band[kind];
}

export function hasListPriceRule(
  propertyCode: string,
  roomType: string,
): boolean {
  return RATE_RULES[propertyCode]?.[roomType] != null;
}
