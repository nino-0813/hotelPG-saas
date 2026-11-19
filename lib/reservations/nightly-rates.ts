const dayMs = 86_400_000;

export type NightlyRate = {
  date: string;
  /** Saved nightly total, including breakfast. */
  amount: number | null;
  breakfast: number;
};

export function nightlyRoomAmount(rate: NightlyRate) {
  return rate.amount === null ? null : rate.amount - rate.breakfast;
}

export function dateOrdinal(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return NaN;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value
    ? NaN
    : date.getTime() / dayMs;
}

export function hotelToday() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
}

export function stayDates(checkIn: string, checkOut: string) {
  const first = dateOrdinal(checkIn);
  const nights = dateOrdinal(checkOut) - first;
  if (!Number.isSafeInteger(nights) || nights <= 0) return [];
  return Array.from({ length: nights }, (_, i) => new Date((first + i) * dayMs).toISOString().slice(0, 10));
}

/** Divide each yen once, with the remainder assigned to the earliest nights. */
export function allocatedYen(total: number, nights: number, index: number) {
  return Math.floor(total / nights) + (index < total % nights ? 1 : 0);
}

export function isYen(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

export function validateNightlyRates(rates: NightlyRate[], dates: string[]) {
  if (!Array.isArray(rates) || rates.length !== dates.length || !dates.length) {
    return "宿泊日と料金明細の日付を確認してください。";
  }
  for (const [index, date] of dates.entries()) {
    const rate = rates[index];
    if (!rate || rate.date !== date || !isYen(rate.breakfast) || (rate.amount !== null && !isYen(rate.amount))) {
      return `${date}の料金は0円以上の整数で入力してください。`;
    }
    if (rate.amount !== null && rate.breakfast > rate.amount) {
      return `${date}の朝食料金は、朝食込みの宿泊料金以下にしてください。`;
    }
  }
  const totals = sumNightlyRates(rates);
  return isYen(totals.amount) && isYen(totals.breakfast) ? null : "合計金額が大きすぎます。";
}

export function sumNightlyRates(rates: NightlyRate[]) {
  return rates.reduce((sum, rate) => ({
    amount: sum.amount + (rate.amount ?? 0),
    breakfast: sum.breakfast + rate.breakfast,
    room: sum.room + (nightlyRoomAmount(rate) ?? 0),
  }), { amount: 0, breakfast: 0, room: 0 });
}

export type BulkRateTarget =
  | { kind: "unset" | "all" }
  | { kind: "range"; start: string; end: string };

type BulkRateOptions = {
  target: BulkRateTarget;
  mode: "nightly" | "total";
  /** Room-only in nightly mode, breakfast-inclusive in total mode. */
  amount: number;
  breakfast?: number;
};

type BulkRatePreview =
  | { error: string }
  | { updates: NightlyRate[]; total: number; overwritten: number; unset: number };

export function previewBulkRates(rates: NightlyRate[], { target, mode, amount, breakfast }: BulkRateOptions): BulkRatePreview {
  if (!isYen(amount) || (breakfast !== undefined && !isYen(breakfast))) {
    return { error: "料金は0円以上の整数で入力してください。" };
  }

  if (target.kind === "range" && (
    !(dateOrdinal(target.start) <= dateOrdinal(target.end)) ||
    target.start < (rates[0]?.date ?? "") ||
    target.end > (rates.at(-1)?.date ?? "")
  )) {
    return { error: "宿泊日の範囲内で、開始日と終了日を指定してください。" };
  }

  const selected = rates.filter((rate) => {
    if (target.kind === "range") return rate.date >= target.start && rate.date <= target.end;
    return target.kind === "all" || rate.amount === null;
  });
  if (!selected.length) return { error: "対象の泊がありません。適用先を変更してください。" };

  const selectedDates = new Set(selected.map((rate) => rate.date));
  const remaining = rates.filter((rate) => !selectedDates.has(rate.date));
  const remainingTotals = sumNightlyRates(remaining);
  if (mode === "total" && remaining.some((rate) => rate.amount === null)) {
    return { error: "契約総額を配分するには、未設定の泊をすべて対象に含めてください。" };
  }
  if (mode === "total" && remainingTotals.amount > amount) {
    return { error: "対象外の泊の料金だけで契約総額を超えています。金額または適用先を確認してください。" };
  }

  const updates = selected.map((rate, index) => {
    const nightlyBreakfast = breakfast ?? rate.breakfast;
    return {
      date: rate.date,
      amount: mode === "total" ? allocatedYen(amount - remainingTotals.amount, selected.length, index) : amount + nightlyBreakfast,
      breakfast: nightlyBreakfast,
    };
  });
  const issue = validateNightlyRates(updates, selected.map((rate) => rate.date));
  if (issue) return { error: issue };

  const updateTotals = sumNightlyRates(updates);
  const total = remainingTotals.amount + updateTotals.amount;
  const breakfastTotal = remainingTotals.breakfast + updateTotals.breakfast;
  if (!isYen(total) || !isYen(breakfastTotal)) return { error: "合計金額が大きすぎます。" };

  const overwritten = selected.filter((rate, index) => rate.amount !== null && (
    rate.amount !== updates[index].amount || rate.breakfast !== updates[index].breakfast
  )).length;
  const unset = remaining.filter((rate) => rate.amount === null).length;
  return { updates, total, overwritten, unset };
}
