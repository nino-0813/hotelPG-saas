import { loadPublicStayAvailability } from "@/lib/availability/load-public-stay-availability";
import {
  computeStripeWebCheckoutChargeJpy,
  type StripeWebCheckoutChargeBreakdown,
} from "@/lib/stripe/stripe-web-checkout-pricing";

export type ComputePublicCheckoutForStayParams = {
  propertyCode: string;
  roomType: string;
  checkInDate: string;
  checkOutDate: string;
  adults: number;
  children: number;
};

/**
 * create-checkout-session と同一: 空室・カタログ料金（シーズン含）から net 合計を出し、Stripe 請求内訳を返す。
 */
export async function computePublicCheckoutForStay(
  params: ComputePublicCheckoutForStayParams,
): Promise<
  | ({ ok: true } & { charge: StripeWebCheckoutChargeBreakdown })
  | { ok: false; status: 409; error: string }
  | { ok: false; status: 500; error: string }
> {
  let stay;
  try {
    stay = await loadPublicStayAvailability({
      propertyCode: params.propertyCode,
      roomType: params.roomType,
      checkInDate: params.checkInDate,
      checkOutDate: params.checkOutDate,
      adults: params.adults,
      children: params.children,
    });
  } catch (e) {
    console.error("[public-checkout] availability load failed", e);
    return { ok: false, status: 500, error: "Availability check failed" };
  }

  const dates = stay.availability.dates;
  const allBookable = dates.every((d) => d.bookable && d.availableRooms > 0);
  const hasNullPrice = dates.some((d) => d.minPrice == null);
  if (!allBookable || hasNullPrice) {
    return { ok: false, status: 409, error: "No availability" };
  }

  const targetRoomNetAmount = dates.reduce((sum, d) => sum + (d.minPrice ?? 0), 0);
  if (!Number.isInteger(targetRoomNetAmount) || targetRoomNetAmount <= 0) {
    return { ok: false, status: 409, error: "Invalid price" };
  }

  const charge = computeStripeWebCheckoutChargeJpy({
    targetRoomNetAmount,
    guestCount: stay.guestCount,
    nights: stay.nights,
  });

  return { ok: true, charge };
}
