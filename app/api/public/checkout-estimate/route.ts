import { differenceInCalendarDays, parseISO } from "date-fns";
import { NextResponse, type NextRequest } from "next/server";
import { validatePg3WashitsuWebGuestCount } from "@/lib/availability/public-rate-rules";
import { computePublicCheckoutForStay } from "@/lib/stripe/compute-public-checkout-for-stay";

export const runtime = "nodejs";

const corsJsonHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsJsonHeaders });
}

type CheckoutEstimateBody = {
  propertyCode?: string;
  roomType?: string;
  checkInDate?: string;
  checkOutDate?: string;
  adults?: number;
  children?: number;
  infants?: number;
};

function isValidYmd(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = parseISO(`${s}T12:00:00`);
  return !Number.isNaN(d.getTime());
}

function bad(msg: string, status = 400) {
  return NextResponse.json({ error: msg }, { status, headers: corsJsonHeaders });
}

export async function POST(req: NextRequest) {
  let payload: CheckoutEstimateBody;
  try {
    payload = (await req.json()) as CheckoutEstimateBody;
  } catch {
    return bad("Invalid JSON body");
  }

  const propertyCode = payload?.propertyCode;
  const roomType = payload?.roomType;
  const checkInDate = payload?.checkInDate;
  const checkOutDate = payload?.checkOutDate;
  const adults = payload?.adults;
  const children = payload?.children;
  const infants = payload?.infants;

  if (!propertyCode || typeof propertyCode !== "string" || !propertyCode.trim()) {
    return bad("propertyCode is required");
  }
  if (!roomType || typeof roomType !== "string" || !roomType.trim()) {
    return bad("roomType is required");
  }
  if (!checkInDate || typeof checkInDate !== "string" || !isValidYmd(checkInDate)) {
    return bad("checkInDate is required");
  }
  if (!checkOutDate || typeof checkOutDate !== "string" || !isValidYmd(checkOutDate)) {
    return bad("checkOutDate is required");
  }

  const nights = differenceInCalendarDays(
    parseISO(`${checkOutDate}T00:00:00`),
    parseISO(`${checkInDate}T00:00:00`),
  );
  if (nights < 1) {
    return bad("checkInDate must be before checkOutDate");
  }

  const a = Number.isFinite(adults) ? Number(adults) : 2;
  const c = Number.isFinite(children) ? Number(children) : 0;
  if (!Number.isFinite(adults) && adults !== undefined) {
    return bad("adults must be a number");
  }
  if (!Number.isFinite(children) && children !== undefined) {
    return bad("children must be a number");
  }
  if (infants !== undefined && (!Number.isFinite(infants) || infants < 0)) {
    return bad("infants must be a non-negative number");
  }

  const guestCount = a + c;
  if (guestCount < 1) {
    return bad("adults + children must be >= 1");
  }
  if (guestCount >= 5) {
    return bad("guestCount must be <= 4");
  }

  if (
    (propertyCode === "PG2" && roomType === "family" && guestCount > 4) ||
    (propertyCode === "PG3" && roomType === "family" && guestCount > 4)
  ) {
    return bad("guestCount exceeds max_guests");
  }

  const pg3WashitsuErr = validatePg3WashitsuWebGuestCount(
    propertyCode,
    roomType,
    guestCount,
  );
  if (pg3WashitsuErr) return bad(pg3WashitsuErr);

  const result = await computePublicCheckoutForStay({
    propertyCode: propertyCode.trim(),
    roomType: roomType.trim(),
    checkInDate,
    checkOutDate,
    adults: a,
    children: c,
  });

  if (!result.ok) {
    const msg = result.error;
    return NextResponse.json(
      { error: msg },
      { status: result.status, headers: corsJsonHeaders },
    );
  }

  const ch = result.charge;
  return NextResponse.json(
    {
      targetRoomNetAmount: ch.targetRoomNetAmount,
      accommodationTaxAmount: ch.accommodationTaxAmount,
      stripeEffectiveFeeRate: ch.stripeEffectiveFeeRate,
      rawStripeChargeAmount: ch.rawStripeChargeAmount,
      stripeChargeAmount: ch.stripeChargeAmount,
      roundingUnit: ch.roundingUnit,
      roundingAmount: ch.roundingAmount,
      guestCount: ch.guestCount,
      nights: ch.nights,
    },
    { headers: corsJsonHeaders },
  );
}
