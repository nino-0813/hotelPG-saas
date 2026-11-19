const dayMs = 86_400_000;

export type NightlyRate = {
  date: string;
  amount: number | null;
  breakfast: number;
};

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
  }), { amount: 0, breakfast: 0 });
}
