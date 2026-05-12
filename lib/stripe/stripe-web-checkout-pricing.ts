/** Stripe 実効手数料率（国内カード等を想定したグロスアップ用） */
export const STRIPE_EFFECTIVE_FEE_RATE = 0.0396;

/** お客様請求額の切り上げ単位（円） */
export const STRIPE_CHARGE_ROUNDING_UNIT_JPY = 1000;

/** 宿泊税: 円 / 人 / 泊（消費税はカタログ料金に内包とみなし別途加算しない） */
export const ACCOMMODATION_TAX_PER_GUEST_PER_NIGHT_JPY = 200;

export type StripeWebCheckoutChargeBreakdown = {
  targetRoomNetAmount: number;
  accommodationTaxAmount: number;
  stripeEffectiveFeeRate: number;
  rawStripeChargeAmount: number;
  stripeChargeAmount: number;
  /** stripeChargeAmount - targetRoomNetAmount - accommodationTaxAmount */
  onlinePaymentFeeAmount: number;
  roundingAmount: number;
  roundingUnit: number;
  nights: number;
  guestCount: number;
};

/**
 * ホテル側に残したい宿泊売上（税込カタログ合計）+ 宿泊税を、実効手数料控除後に残るようグロスアップし、100円単位で切り上げた請求額。
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
  const rawStripeChargeAmount = Math.ceil(
    sumNetPlusTax / (1 - STRIPE_EFFECTIVE_FEE_RATE),
  );
  const stripeChargeAmount =
    Math.ceil(rawStripeChargeAmount / STRIPE_CHARGE_ROUNDING_UNIT_JPY) *
    STRIPE_CHARGE_ROUNDING_UNIT_JPY;
  const roundingAmount = stripeChargeAmount - rawStripeChargeAmount;
  const onlinePaymentFeeAmount = stripeChargeAmount - sumNetPlusTax;

  return {
    targetRoomNetAmount,
    accommodationTaxAmount,
    stripeEffectiveFeeRate: STRIPE_EFFECTIVE_FEE_RATE,
    rawStripeChargeAmount,
    stripeChargeAmount,
    onlinePaymentFeeAmount,
    roundingAmount,
    roundingUnit: STRIPE_CHARGE_ROUNDING_UNIT_JPY,
    nights,
    guestCount,
  };
}

/** Webhook / 予約備考用（200 文字以内に収まる想定の短文） */
export function formatStripeWebReservationSpecialNotes(params: {
  targetRoomNetAmount: number;
  accommodationTaxAmount: number;
  stripeChargeAmount: number;
  roundingAmount: number;
}): string {
  const yen = (n: number) =>
    `${Math.max(0, Math.round(n)).toLocaleString("ja-JP")}円`;
  return `公式サイトStripe決済 / 宿泊売上目標: ${yen(params.targetRoomNetAmount)} / 宿泊税: ${yen(params.accommodationTaxAmount)} / 請求額: ${yen(params.stripeChargeAmount)} / 丸め調整: ${yen(params.roundingAmount)}`;
}
