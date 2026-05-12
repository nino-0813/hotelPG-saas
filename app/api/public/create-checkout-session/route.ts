import { differenceInCalendarDays, parseISO } from "date-fns";
import { NextResponse, type NextRequest } from "next/server";
import { computePublicCheckoutForStay } from "@/lib/stripe/compute-public-checkout-for-stay";
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

  const pricing = await computePublicCheckoutForStay({
    propertyCode,
    roomType,
    checkInDate,
    checkOutDate,
    adults: a,
    children: c,
  });
  if (!pricing.ok) {
    if (pricing.status === 500) {
      console.error("[public/create-checkout-session]", pricing.error);
      return bad(pricing.error, 500);
    }
    return bad(pricing.error, 409);
  }
  const charge = pricing.charge;

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
        stripeEffectiveFeeRate: String(charge.stripeEffectiveFeeRate),
        rawStripeChargeAmount: String(charge.rawStripeChargeAmount),
        stripeChargeAmount: String(charge.stripeChargeAmount),
        roundingUnit: String(charge.roundingUnit),
        roundingAmount: String(charge.roundingAmount),
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
