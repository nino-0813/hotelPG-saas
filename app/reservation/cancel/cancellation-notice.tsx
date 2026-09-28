type CancellationNoticeProps = {
  normalPolicy?: "full" | "deduct_processing_fee";
  processingFeeRate?: number;
  isLastMinute?: boolean;
  lastMinuteFeeType?: "percentage" | "fixed";
  lastMinuteFeeValue?: number;
};

const formatYen = (value: number) => `${Math.max(0, value).toLocaleString("ja-JP")}円`;

export function CancellationNotice({
  normalPolicy = "full",
  processingFeeRate = 3.96,
  isLastMinute = false,
  lastMinuteFeeType = "percentage",
  lastMinuteFeeValue = 0,
}: CancellationNoticeProps) {
  const refundRule = isLastMinute
    ? `ホテル規定のキャンセル料（${lastMinuteFeeType === "percentage" ? `決済金額の${lastMinuteFeeValue}%` : formatYen(lastMinuteFeeValue)}）を差し引いた金額`
    : normalPolicy === "deduct_processing_fee"
      ? `決済手数料相当額（決済金額の${processingFeeRate}%）を差し引いた金額`
      : "決済金額の全額";

  return (
    <section
      aria-labelledby="cancellation-notice-title"
      className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-7 text-neutral-800 sm:p-5"
    >
      <h2
        id="cancellation-notice-title"
        className="text-base font-semibold text-neutral-950"
      >
        ■ キャンセル手続きの前に必ずご確認ください
      </h2>
      <p className="mt-3">これよりキャンセルの手続きを行います。</p>
      <p className="mt-2">
        事前決済でお支払いいただいた宿泊料金は、当サイトの規定に基づき、
        {refundRule}をご登録のクレジットカードへ返金します。
      </p>
      <ul className="mt-3 space-y-1 text-neutral-700">
        <li>
          ※キャンセル受付後、ホテル側で内容を確認してStripeから返金手続きを行います。
        </li>
        <li>
          ※カードへの反映時期はカード会社により異なります。
        </li>
      </ul>
    </section>
  );
}
