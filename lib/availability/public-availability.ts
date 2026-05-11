import { addDays, format, parseISO } from "date-fns";

/** Max guests per room_type when DB has no capacity column. */
const ROOM_TYPE_MAX_GUESTS: Record<string, number> = {
  single: 2,
  standard: 2,
  family: 6,
  washitsu_modern_4: 4,
  washitsu_modern_3: 3,
};

/** Fallback nightly rate (yen) for minPrice when rooms.base_price is absent. */
const ROOM_TYPE_DEFAULT_PRICE: Record<string, number> = {
  single: 7000,
  standard: 8000,
  family: 12000,
  washitsu_modern_4: 15000,
  washitsu_modern_3: 13000,
};

export type PublicRoomRow = {
  id: string;
  property_id: string;
  room_type: string;
  capacity?: number | null;
  base_price?: number | null;
  is_active?: boolean | null;
};

export type PublicReservationRow = {
  room_id: string | null;
  requested_property_id: string | null;
  requested_room_type: string | null;
  check_in_date: string;
  check_out_date: string;
  status: string;
};

export type PublicDateAvailability = {
  date: string;
  availableRooms: number;
  minPrice: number | null;
  bookable: boolean;
};

export type PublicAvailabilityComputeOptions = {
  /**
   * When set (e.g. PG1 + standard from the website), overrides minPrice for each date
   * using published rate rules; falls back to room-based pricing when it returns null.
   * `guestCount` is adults + children from the API.
   */
  listPriceForDate?: (dateYmd: string, guestCount: number) => number | null;
};

function roomMaxGuests(row: PublicRoomRow): number {
  if (typeof row.capacity === "number" && row.capacity > 0) {
    return row.capacity;
  }
  return ROOM_TYPE_MAX_GUESTS[row.room_type] ?? 2;
}

function roomUnitPrice(row: PublicRoomRow): number {
  if (typeof row.base_price === "number" && row.base_price > 0) {
    return row.base_price;
  }
  return ROOM_TYPE_DEFAULT_PRICE[row.room_type] ?? 8000;
}

function isRoomSellable(row: PublicRoomRow, partySize: number): boolean {
  if (row.is_active === false) return false;
  return roomMaxGuests(row) >= partySize;
}

/** Night `d` is occupied iff check_in_date <= d < check_out_date (checkout day is free). */
export function dateInStayRange(
  d: string,
  checkIn: string,
  checkOut: string,
): boolean {
  return checkIn <= d && d < checkOut;
}

/** Blocking occupancy: confirmed + checked_in (excludes cancelled / checked_out). */
function countsTowardOccupancy(status: string): boolean {
  return status === "confirmed" || status === "checked_in";
}

type PropertyTypeKey = `${string}|${string}`;

/**
 * Computes per-day aggregate availability for the public calendar API.
 * Does not expose any reservation PII — only derived counts and prices.
 */
export function computePublicAvailabilityByDate(
  startDate: string,
  days: number,
  partySize: number,
  rooms: PublicRoomRow[],
  reservations: PublicReservationRow[],
  options?: PublicAvailabilityComputeOptions,
): { start: string; days: number; dates: PublicDateAvailability[] } {
  const start = parseISO(`${startDate}T00:00:00`);
  const dateStrings: string[] = [];
  for (let i = 0; i < days; i++) {
    dateStrings.push(format(addDays(start, i), "yyyy-MM-dd"));
  }

  const sellable = rooms.filter((r) => isRoomSellable(r, partySize));

  const dates: PublicDateAvailability[] = dateStrings.map((d) => {
    const assignedOccupied = new Set<string>();
    for (const res of reservations) {
      if (!countsTowardOccupancy(res.status)) continue;
      if (!res.room_id) continue;
      if (dateInStayRange(d, res.check_in_date, res.check_out_date)) {
        assignedOccupied.add(res.room_id);
      }
    }

    const unassignedByPropertyType = new Map<PropertyTypeKey, number>();
    const unassignedOrphanByType = new Map<string, number>();

    for (const res of reservations) {
      if (!countsTowardOccupancy(res.status)) continue;
      if (res.room_id) continue;
      const rt = res.requested_room_type;
      if (!rt || !dateInStayRange(d, res.check_in_date, res.check_out_date)) {
        continue;
      }
      const pid = res.requested_property_id;
      if (pid) {
        const key: PropertyTypeKey = `${pid}|${rt}`;
        unassignedByPropertyType.set(
          key,
          (unassignedByPropertyType.get(key) ?? 0) + 1,
        );
      } else {
        unassignedOrphanByType.set(rt, (unassignedOrphanByType.get(rt) ?? 0) + 1);
      }
    }

    const physicalFreeByPropertyType = new Map<PropertyTypeKey, number>();

    for (const r of sellable) {
      const key: PropertyTypeKey = `${r.property_id}|${r.room_type}`;
      if (!assignedOccupied.has(r.id)) {
        physicalFreeByPropertyType.set(
          key,
          (physicalFreeByPropertyType.get(key) ?? 0) + 1,
        );
      }
    }

    const types = new Set<string>();
    for (const r of sellable) {
      types.add(r.room_type);
    }

    const typeFloorPrice = new Map<string, number>();
    for (const t of types) {
      let m: number | null = null;
      for (const r of sellable) {
        if (r.room_type !== t) continue;
        const p = roomUnitPrice(r);
        m = m === null ? p : Math.min(m, p);
      }
      if (m !== null) typeFloorPrice.set(t, m);
    }

    let availableRooms = 0;
    const minPriceCandidates: number[] = [];

    for (const t of types) {
      let pool = 0;
      let unassignedForType = unassignedOrphanByType.get(t) ?? 0;

      for (const [key, free] of physicalFreeByPropertyType) {
        const pipe = key.indexOf("|");
        if (pipe === -1) continue;
        const roomTypeFromKey = key.slice(pipe + 1);
        if (roomTypeFromKey !== t) continue;
        pool += free;
        const u = unassignedByPropertyType.get(key) ?? 0;
        unassignedForType += u;
      }

      const availType = Math.max(0, pool - unassignedForType);
      availableRooms += availType;
      if (availType > 0) {
        const floor = typeFloorPrice.get(t);
        if (floor !== undefined) {
          minPriceCandidates.push(floor);
        }
      }
    }

    let minPrice: number | null =
      minPriceCandidates.length === 0
        ? null
        : Math.min(...minPriceCandidates);

    if (availableRooms > 0 && options?.listPriceForDate) {
      const listed = options.listPriceForDate(d, partySize);
      if (listed != null && Number.isFinite(listed)) {
        minPrice = listed;
      }
    }

    return {
      date: d,
      availableRooms,
      minPrice,
      bookable: availableRooms >= 1,
    };
  });

  return { start: startDate, days, dates };
}
