/** Stripe domestic card fee (Japan) — gross-up divisor is (1 - this). */
export const STRIPE_DOMESTIC_CARD_FEE_RATE = 0.036;

/** 宿泊税: 円 / 人 / 泊（消費税はカタログ料金に内包とみなし別途加算しない） */
export const ACCOMMODATION_TAX_PER_GUEST_PER_NIGHT_JPY = 200;

export type StripeWebCheckoutChargeBreakdown = {
  targetRoomNetAmount: number;
  accommodationTaxAmount: number;
  stripeFeeRate: number;
  stripeChargeAmount: number;
  nights: number;
  guestCount: number;
};

/**
 * ホテル側宿泊売上（カタログ目標の合計）+ 宿泊税を、Stripe 3.6% 控除後に残るようにグロスアップした請求額（円、切り上げ）。
 */
export function computeStripeWebCheckoutChargeJpy(params: {
  targetRoomNetAmount: number;
  guestCount: number;
  nights: number;
}): StripeWebCheckoutChargeBreakdown {
  const guestCount = Math.max(1, Math.floor(params.guestCount));
  const nights = Math.max(1, Math.floor(params.nights));
  const targetRoomNetAmount = Math.max(0, Math.floor(params.targetRoomNetAmount));

  const accommodationTaxAmount =
    ACCOMMODATION_TAX_PER_GUEST_PER_NIGHT_JPY * guestCount * nights;
  const sumNetPlusTax = targetRoomNetAmount + accommodationTaxAmount;
  const stripeChargeAmount = Math.ceil(
    sumNetPlusTax / (1 - STRIPE_DOMESTIC_CARD_FEE_RATE),
  );

  return {
    targetRoomNetAmount,
    accommodationTaxAmount,
    stripeFeeRate: STRIPE_DOMESTIC_CARD_FEE_RATE,
    stripeChargeAmount,
    nights,
    guestCount,
  };
}

/** Webhook / 予約備考用（200 文字以内に収まる想定の短文） */
export function formatStripeWebReservationSpecialNotes(params: {
  targetRoomNetAmount: number;
  accommodationTaxAmount: number;
  stripeChargeAmount: number;
}): string {
  const yen = (n: number) =>
    `${Math.max(0, Math.round(n)).toLocaleString("ja-JP")}円`;
  return `公式サイトStripe決済 / 宿泊売上目標: ${yen(params.targetRoomNetAmount)} / 宿泊税: ${yen(params.accommodationTaxAmount)} / Stripe請求額: ${yen(params.stripeChargeAmount)}`;
}
