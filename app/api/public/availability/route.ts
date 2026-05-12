import { addDays, format, parseISO } from "date-fns";
import { NextResponse, type NextRequest } from "next/server";
import {
  computePublicAvailabilityByDate,
  type PublicReservationRow,
  type PublicRoomRow,
} from "@/lib/availability/public-availability";
import { buildPublicListPriceForDate } from "@/lib/availability/public-catalog-pricing";
import { resolvePublicAvailabilityCap } from "@/lib/availability/public-inventory-caps";
import {
  hasListPriceRule,
  resolvePg3WebCatalogRoomType,
} from "@/lib/availability/public-rate-rules";
import { fetchGuestPriceRulesForCatalog } from "@/lib/availability/guest-price-rules";
import {
  fetchSeasonalRoomRatesForWindow,
  pickBestSeasonalRateForDate,
} from "@/lib/availability/seasonal-room-rates";
import type {
  PublicGuestPriceRuleRow,
  PublicInventoryCapRow,
  PublicRoomSettingRow,
  PublicSeasonalRoomRateRow,
} from "@/lib/types/public-catalog";
import { createServiceRoleSupabase } from "@/lib/supabase/service-role";

export const runtime = "nodejs";

const MAX_DAYS = 93;
const DEFAULT_DAYS = 31;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isValidYmd(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = parseISO(`${s}T12:00:00`);
  return !Number.isNaN(d.getTime());
}

function parseStartDate(raw: string | null): string {
  if (raw && isValidYmd(raw)) return raw;
  return format(new Date(), "yyyy-MM-dd");
}

function parseDays(raw: string | null): number {
  if (raw === null || raw === "") return DEFAULT_DAYS;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) return DEFAULT_DAYS;
  return Math.min(n, MAX_DAYS);
}

function parseNonNegInt(raw: string | null, fallback: number): number {
  if (raw === null || raw === "") return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return n;
}

function trimParam(raw: string | null): string | null {
  if (raw === null) return null;
  const t = raw.trim();
  return t === "" ? null : t;
}

/** Resolves API roomType param to DB room_type filter list (PG3 family/standard →人数別 washitsu). */
function resolveRoomTypesForFilter(
  resolvedPropertyCode: string | null,
  roomTypeParam: string | null,
  partySize: number,
): string[] | null {
  if (!roomTypeParam) return null;
  if (resolvedPropertyCode === "PG3") {
    return [
      resolvePg3WebCatalogRoomType(
        resolvedPropertyCode,
        roomTypeParam,
        partySize,
      ),
    ];
  }
  return [roomTypeParam];
}

const corsJsonHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsJsonHeaders });
}

type PropertyRow = { id: string; code: string };

function appendRequestedRoomTypeFilter(
  parts: string[],
  roomTypesFilter: string[],
): void {
  if (roomTypesFilter.length === 1) {
    parts.push(`requested_room_type.eq.${roomTypesFilter[0]}`);
  } else {
    parts.push(`requested_room_type.in.(${roomTypesFilter.join(",")})`);
  }
}

async function loadReservationsForAvailability(
  supabase: ReturnType<typeof createServiceRoleSupabase>,
  start: string,
  lastDateStr: string,
  roomIds: string[],
  resolvedPropertyId: string | null,
  roomTypesFilter: string[] | null,
  hasRoomOrPropertyFilter: boolean,
): Promise<{ data: PublicReservationRow[] | null; error: Error | null }> {
  const base = supabase
    .from("reservations")
    .select(
      "room_id, requested_room_type, requested_property_id, check_in_date, check_out_date, status",
    )
    .in("status", ["confirmed", "checked_in", "blocked", "manual"])
    .lte("check_in_date", lastDateStr)
    .gt("check_out_date", start);

  if (!hasRoomOrPropertyFilter) {
    const { data, error } = await base.returns<PublicReservationRow[]>();
    return { data, error: error as Error | null };
  }

  const hasRoomType = roomTypesFilter !== null && roomTypesFilter.length > 0;

  if (roomIds.length === 0) {
    let q = base.is("room_id", null);
    if (resolvedPropertyId) {
      q = q.eq("requested_property_id", resolvedPropertyId);
    }
    if (hasRoomType) {
      if (roomTypesFilter!.length === 1) {
        q = q.eq("requested_room_type", roomTypesFilter![0]);
      } else {
        q = q.in("requested_room_type", roomTypesFilter!);
      }
    }
    const { data, error } = await q.returns<PublicReservationRow[]>();
    return { data, error: error as Error | null };
  }

  const inList = roomIds.join(",");
  let orExpr: string;

  if (resolvedPropertyId && hasRoomType) {
    const andParts = [
      "room_id.is.null",
      `requested_property_id.eq.${resolvedPropertyId}`,
    ];
    appendRequestedRoomTypeFilter(andParts, roomTypesFilter!);
    orExpr = `room_id.in.(${inList}),and(${andParts.join(",")})`;
  } else if (resolvedPropertyId) {
    orExpr = `room_id.in.(${inList}),and(room_id.is.null,requested_property_id.eq.${resolvedPropertyId})`;
  } else if (hasRoomType) {
    const andParts = ["room_id.is.null"];
    appendRequestedRoomTypeFilter(andParts, roomTypesFilter!);
    orExpr = `room_id.in.(${inList}),and(${andParts.join(",")})`;
  } else {
    orExpr = `room_id.in.(${inList})`;
  }

  const { data, error } = await base.or(orExpr).returns<PublicReservationRow[]>();
  return { data, error: error as Error | null };
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const start = parseStartDate(searchParams.get("start"));
    const days = parseDays(searchParams.get("days"));
    const adults = parseNonNegInt(searchParams.get("adults"), 2);
    const children = parseNonNegInt(searchParams.get("children"), 0);
    const partySize = Math.max(1, adults + children);

    const propertyCodeParam = trimParam(searchParams.get("propertyCode"));
    const propertyIdParam = trimParam(searchParams.get("propertyId"));
    const roomTypeParam = trimParam(searchParams.get("roomType"));

    const lastDateStr = format(
      addDays(parseISO(`${start}T12:00:00`), days - 1),
      "yyyy-MM-dd",
    );

    const supabase = createServiceRoleSupabase();

    let resolvedPropertyId: string | null = null;
    let resolvedPropertyCode: string | null = null;

    if (propertyIdParam) {
      if (!UUID_RE.test(propertyIdParam)) {
        return NextResponse.json(
          { error: "Invalid propertyId" },
          { status: 400, headers: corsJsonHeaders },
        );
      }
      const { data: byId, error: idErr } = await supabase
        .from("properties")
        .select("id, code")
        .eq("id", propertyIdParam)
        .maybeSingle()
        .returns<PropertyRow>();

      if (idErr || !byId) {
        return NextResponse.json(
          { error: "Unknown propertyId" },
          { status: 404, headers: corsJsonHeaders },
        );
      }
      resolvedPropertyId = byId.id;
      resolvedPropertyCode = byId.code;
      if (
        propertyCodeParam &&
        propertyCodeParam.toUpperCase() !== byId.code.toUpperCase()
      ) {
        return NextResponse.json(
          { error: "propertyCode does not match propertyId" },
          { status: 400, headers: corsJsonHeaders },
        );
      }
    } else if (propertyCodeParam) {
      const { data: byCode, error: codeErr } = await supabase
        .from("properties")
        .select("id, code")
        .eq("code", propertyCodeParam)
        .maybeSingle()
        .returns<PropertyRow>();

      if (codeErr || !byCode) {
        return NextResponse.json(
          { error: "Unknown propertyCode" },
          { status: 404, headers: corsJsonHeaders },
        );
      }
      resolvedPropertyId = byCode.id;
      resolvedPropertyCode = byCode.code;
    }

    const roomTypesFilter = resolveRoomTypesForFilter(
      resolvedPropertyCode,
      roomTypeParam,
      partySize,
    );

    let roomsQuery = supabase
      .from("rooms")
      .select("id, property_id, room_type, room_number, display_order");

    if (resolvedPropertyId) {
      roomsQuery = roomsQuery.eq("property_id", resolvedPropertyId);
    }
    if (roomTypesFilter) {
      if (roomTypesFilter.length === 1) {
        roomsQuery = roomsQuery.eq("room_type", roomTypesFilter[0]);
      } else {
        roomsQuery = roomsQuery.in("room_type", roomTypesFilter);
      }
    }

    const { data: roomsRaw, error: roomsErr } =
      await roomsQuery.returns<PublicRoomRow[]>();

    if (roomsErr) {
      console.error("[public/availability] rooms", roomsErr);
      return NextResponse.json(
        { error: "Failed to load rooms" },
        { status: 500, headers: corsJsonHeaders },
      );
    }

    const rooms = (roomsRaw ?? []) as PublicRoomRow[];
    const roomIds = rooms.map((r) => r.id);

    const hasRoomOrPropertyFilter =
      resolvedPropertyId !== null || roomTypeParam !== null;

    const { data: reservationsRaw, error: resErr } =
      await loadReservationsForAvailability(
        supabase,
        start,
        lastDateStr,
        roomIds,
        resolvedPropertyId,
        roomTypesFilter,
        hasRoomOrPropertyFilter,
      );

    if (resErr) {
      console.error("[public/availability] reservations", resErr);
      return NextResponse.json(
        { error: "Failed to load reservations" },
        { status: 500, headers: corsJsonHeaders },
      );
    }

    const reservations = (reservationsRaw ?? []) as PublicReservationRow[];

    const rateCode = resolvedPropertyCode;
    const catalogRateRoomType =
      rateCode && roomTypeParam
        ? resolvePg3WebCatalogRoomType(rateCode, roomTypeParam, partySize)
        : roomTypeParam;

    let dbRoomSetting: PublicRoomSettingRow | null = null;
    let dbInventoryCaps: PublicInventoryCapRow[] | null = null;
    let seasonalRows: PublicSeasonalRoomRateRow[] = [];
    let guestPriceRules: PublicGuestPriceRuleRow[] = [];

    if (rateCode && catalogRateRoomType) {
      const [rsRes, icRes, seasonal, guestRules] = await Promise.all([
        supabase
          .from("public_room_settings")
          .select("*")
          .eq("property_code", rateCode)
          .eq("room_type", catalogRateRoomType)
          .maybeSingle(),
        supabase
          .from("public_inventory_caps")
          .select("*")
          .eq("property_code", rateCode)
          .eq("room_type", catalogRateRoomType),
        fetchSeasonalRoomRatesForWindow(supabase, {
          propertyCode: rateCode,
          roomType: catalogRateRoomType,
          startYmd: start,
          endYmd: lastDateStr,
        }),
        fetchGuestPriceRulesForCatalog(supabase, {
          propertyCode: rateCode,
          roomType: catalogRateRoomType,
        }),
      ]);

      seasonalRows = seasonal;
      guestPriceRules = guestRules;

      if (rsRes.error) {
        console.error("[public/availability] public_room_settings", rsRes.error);
      } else {
        dbRoomSetting = (rsRes.data as PublicRoomSettingRow | null) ?? null;
      }
      if (icRes.error) {
        console.error("[public/availability] public_inventory_caps", icRes.error);
        dbInventoryCaps = null;
      } else {
        dbInventoryCaps = (icRes.data as PublicInventoryCapRow[] | null) ?? [];
      }
    }

    const hasDbPrice =
      dbRoomSetting !== null && dbRoomSetting.is_active === true;
    const hasCodePrice =
      !hasDbPrice &&
      rateCode !== null &&
      catalogRateRoomType !== null &&
      hasListPriceRule(rateCode, catalogRateRoomType);
    const hasSeasonal = seasonalRows.length > 0;
    const hasGuestPriceRules = guestPriceRules.length > 0;

    const listPriceForDateFn =
      hasDbPrice || hasCodePrice || hasSeasonal || hasGuestPriceRules
        ? buildPublicListPriceForDate({
            propertyCode: rateCode!,
            roomType: catalogRateRoomType!,
            dbRoomSetting,
            seasonalRows,
            guestPriceRules,
          })
        : undefined;

    const availabilityCap = resolvePublicAvailabilityCap(
      rateCode,
      catalogRateRoomType ?? roomTypeParam,
      roomTypesFilter,
      partySize,
      dbInventoryCaps,
    );

    const availabilityCapForDate =
      rateCode && catalogRateRoomType
        ? (dateYmd: string) => {
            const o = pickBestSeasonalRateForDate(
              seasonalRows,
              dateYmd,
            )?.inventory_cap_override;
            if (o != null && Number.isFinite(o) && o >= 0) return o;
            return null;
          }
        : undefined;

    const computeOptions =
      listPriceForDateFn != null ||
      availabilityCap != null ||
      (availabilityCapForDate != null && rateCode && catalogRateRoomType) ||
      (rateCode && catalogRateRoomType)
        ? {
            ...(listPriceForDateFn
              ? { listPriceForDate: listPriceForDateFn }
              : {}),
            ...(availabilityCap != null
              ? { availabilityCap }
              : {}),
            ...(rateCode && catalogRateRoomType && availabilityCapForDate
              ? { availabilityCapForDate }
              : {}),
            ...(rateCode && catalogRateRoomType
              ? { includeStripeWebCheckoutEstimate: true as const }
              : {}),
            ...(process.env.NODE_ENV === "development"
              ? {
                  debug: {
                    propertyCode: rateCode ?? null,
                    propertyId: resolvedPropertyId ?? null,
                    roomType: catalogRateRoomType ?? roomTypeParam ?? null,
                    roomIds,
                    reservationsFetchedCount: reservations.length,
                  },
                }
              : {}),
          }
        : undefined;

    const body = computePublicAvailabilityByDate(
      start,
      days,
      partySize,
      rooms,
      reservations,
      computeOptions,
    );

    return NextResponse.json(body, {
      headers: {
        ...corsJsonHeaders,
        "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120",
      },
    });
  } catch (e) {
    console.error("[public/availability]", e);
    const message = e instanceof Error ? e.message : "Internal error";
    const isConfig = message.includes("Missing Supabase");
    return NextResponse.json(
      { error: isConfig ? "Service misconfigured" : "Internal error" },
      { status: isConfig ? 503 : 500, headers: corsJsonHeaders },
    );
  }
}
