import { differenceInCalendarDays, parseISO } from "date-fns";
import { NextResponse, type NextRequest } from "next/server";
import { loadPublicStayAvailability } from "@/lib/availability/load-public-stay-availability";
import { computeStripeWebCheckoutChargeJpy } from "@/lib/stripe/stripe-web-checkout-pricing";
import { createStripeCheckoutSession } from "@/lib/stripe/stripe-api";

export const runtime = "nodejs";

const corsJsonHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsJsonHeaders });
}

type CreateCheckoutBody = {
  propertyCode: string;
  roomType: string;
  checkInDate: string;
  checkOutDate: string;
  adults: number;
  children: number;
  guestName: string;
  guestEmail: string;
  guestPhone?: string | null;
  successUrl: string;
  cancelUrl: string;
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
  let payload: CreateCheckoutBody;
  try {
    payload = (await req.json()) as CreateCheckoutBody;
  } catch {
    return bad("Invalid JSON body");
  }

  const propertyCode = payload?.propertyCode;
  const roomType = payload?.roomType;
  const checkInDate = payload?.checkInDate;
  const checkOutDate = payload?.checkOutDate;
  const adults = payload?.adults;
  const children = payload?.children;
  const guestName = payload?.guestName;
  const guestEmail = payload?.guestEmail;
  const guestPhone = payload?.guestPhone;
  const successUrl = payload?.successUrl;
  const cancelUrl = payload?.cancelUrl;

  if (!propertyCode) return bad("propertyCode is required");
  if (!roomType) return bad("roomType is required");
  if (!checkInDate || !isValidYmd(checkInDate)) return bad("checkInDate is required");
  if (!checkOutDate || !isValidYmd(checkOutDate)) return bad("checkOutDate is required");

  const nights = differenceInCalendarDays(
    parseISO(`${checkOutDate}T00:00:00`),
    parseISO(`${checkInDate}T00:00:00`),
  );
  if (nights < 1) return bad("checkInDate must be before checkOutDate");

  const a = Number.isFinite(adults) ? Number(adults) : 2;
  const c = Number.isFinite(children) ? Number(children) : 0;
  const guestCount = a + c;
  if (guestCount < 1) return bad("adults + children must be >= 1");
  if (guestCount >= 5) return bad("guestCount must be <= 4");

  if (!guestName || typeof guestName !== "string" || !guestName.trim()) {
    return bad("guestName is required");
  }
  if (!guestEmail || typeof guestEmail !== "string" || !guestEmail.trim()) {
    return bad("guestEmail is required");
  }
  if (!successUrl || !cancelUrl) return bad("successUrl and cancelUrl are required");

  if (
    (propertyCode === "PG2" && roomType === "family" && guestCount > 4) ||
    (propertyCode === "PG3" && roomType === "family" && guestCount > 4)
  ) {
    return bad("guestCount exceeds max_guests");
  }

  let stay;
  try {
    stay = await loadPublicStayAvailability({
      propertyCode,
      roomType,
      checkInDate,
      checkOutDate,
      adults: a,
      children: c,
    });
  } catch (e) {
    console.error("[public/create-checkout-session] availability", e);
    return bad("Availability check failed", 500);
  }

  const dates = stay.availability.dates;
  const allBookable = dates.every((d) => d.bookable && d.availableRooms > 0);
  const hasNullPrice = dates.some((d) => d.minPrice == null);
  if (!allBookable || hasNullPrice) {
    return bad("No availability", 409);
  }

  const targetRoomNetAmount = dates.reduce((sum, d) => sum + (d.minPrice ?? 0), 0);
  if (!Number.isInteger(targetRoomNetAmount) || targetRoomNetAmount <= 0) {
    return bad("Invalid price", 409);
  }

  const charge = computeStripeWebCheckoutChargeJpy({
    targetRoomNetAmount,
    guestCount: stay.guestCount,
    nights: stay.nights,
  });

  try {
    const session = await createStripeCheckoutSession({
      amountJpy: charge.stripeChargeAmount,
      customerEmail: guestEmail,
      successUrl,
      cancelUrl,
      metadata: {
        propertyCode,
        roomType,
        checkInDate,
        checkOutDate,
        adults: String(a),
        children: String(c),
        guestName: guestName.trim().slice(0, 60),
        guestEmail: guestEmail.trim().slice(0, 120),
        guestPhone: (guestPhone ?? "").toString().slice(0, 30),
        targetRoomNetAmount: String(charge.targetRoomNetAmount),
        accommodationTaxAmount: String(charge.accommodationTaxAmount),
        stripeFeeRate: String(charge.stripeFeeRate),
        stripeChargeAmount: String(charge.stripeChargeAmount),
        nights: String(charge.nights),
        guestCount: String(charge.guestCount),
        totalAmount: String(charge.stripeChargeAmount),
        source: "stripe_web",
      },
    });

    return NextResponse.json(
      { checkoutUrl: session.url, sessionId: session.id },
      { headers: corsJsonHeaders },
    );
  } catch (e) {
    console.error("[public/create-checkout-session] stripe", e);
    return bad("Failed to create checkout session", 500);
  }
}
