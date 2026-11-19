import type { Reservation } from "@/lib/types/database";
import { allocatedYen, isYen, stayDates, sumNightlyRates, type NightlyRate } from "./reservations/nightly-rates";

type RateReservation = Pick<Reservation, "special_notes" | "nightly_rates" | "check_in_date" | "check_out_date">;

export function sourceLabel(source: string | null | undefined) {
  const value = (source ?? "").toLowerCase();
  if (value.includes("stripe") || value.includes("web")) return "公式サイト";
  if (value.includes("rakuten")) return "楽天";
  if (value.includes("phone") || value.includes("電話")) return "電話";
  if (value.includes("walk") || value.includes("onsite") || value.includes("現地")) return "現地予約";
  if (value === "manual" || !value) return "手入力・その他";
  return source ?? "手入力・その他";
}

export function extractPlan(note: string | null) {
  return note?.match(/プラン:\s*([^\n]+)/)?.[1]?.trim() || "プラン指定なし";
}

function firstAmount(note: string, patterns: RegExp[]) {
  for (const pattern of patterns) {
    const match = note.match(pattern);
    if (match) return Number(match[1].replaceAll(",", ""));
  }
  return null;
}

function legacyRevenue(row: Pick<Reservation, "special_notes">) {
  const note = (row.special_notes ?? "").replace(
    /^朝食料金:\s*[¥￥]?\s*[0-9,]+円?\s*\n?/gm,
    "",
  );
  return firstAmount(note, [
    /売上金額:\s*[¥￥]?\s*([0-9,]+)円?/,
    /宿泊売上目標:\s*[¥￥]?\s*([0-9,]+)円?/,
    /料金:\s*[¥￥]?\s*([0-9,]+)[円-]?/,
    /請求額:\s*[¥￥]?\s*([0-9,]+)円?/,
    /[¥￥]\s*([0-9,]+)[円-]?/,
  ]);
}

export function reservationRevenue(row: Pick<Reservation, "special_notes"> & Partial<RateReservation>) {
  const saved = savedRatesForStay(row);
  return saved ? sumNightlyRates(saved).amount : (legacyRevenue(row) ?? 0);
}

export function reservationBreakfastFee(
  row: Pick<Reservation, "special_notes"> & Partial<RateReservation>,
) {
  const saved = savedRatesForStay(row);
  return saved ? sumNightlyRates(saved).breakfast : legacyBreakfastFee(row);
}

function legacyBreakfastFee(row: Pick<Reservation, "special_notes">) {
  return firstAmount(row.special_notes ?? "", [
    /朝食料金:\s*[¥￥]?\s*([0-9,]+)円?/,
  ]) ?? 0;
}

function savedRatesForStay(row: Partial<RateReservation>) {
  if (!Array.isArray(row.nightly_rates)) return null;
  return row.nightly_rates.filter((rate) =>
    (!row.check_in_date || rate.date >= row.check_in_date) &&
    (!row.check_out_date || rate.date < row.check_out_date),
  );
}

export function reservationNightlyRates(row: RateReservation): { rates: NightlyRate[]; estimated: boolean } {
  const dates = stayDates(row.check_in_date, row.check_out_date);
  const saved = savedRatesForStay(row);
  if (saved) {
    const byDate = new Map(saved.map((rate) => [rate.date, rate]));
    return { rates: dates.map((date) => byDate.get(date) ?? { date, amount: null, breakfast: 0 }), estimated: false };
  }

  const total = legacyRevenue(row);
  const breakfast = legacyBreakfastFee(row);
  return {
    rates: dates.map((date, index) => ({
      date,
      amount: isYen(total) ? allocatedYen(total, dates.length, index) : null,
      breakfast: isYen(breakfast) ? allocatedYen(breakfast, dates.length, index) : 0,
    })),
    estimated: dates.length > 1 && (isYen(total) || breakfast > 0),
  };
}

export function reservationMemo(row: Pick<Reservation, "special_notes">) {
  return (row.special_notes ?? "")
    .replace(/^売上金額:\s*[¥￥]?\s*[0-9,]+円?\s*\n?/gm, "")
    .replace(/^朝食料金:\s*[¥￥]?\s*[0-9,]+円?\s*\n?/gm, "")
    .trim();
}

export function withReservationAmounts(
  note: string,
  totalAmount: number,
  breakfastFee: number,
) {
  const cleaned = reservationMemo({ special_notes: note });
  const amountLines = [
    totalAmount > 0
      ? `売上金額: ${Math.round(totalAmount).toLocaleString("ja-JP")}円`
      : "",
    breakfastFee > 0
      ? `朝食料金: ${Math.round(breakfastFee).toLocaleString("ja-JP")}円`
      : "",
  ].filter(Boolean);

  return [...amountLines, cleaned].filter(Boolean).join("\n");
}

export function withRevenueAmount(note: string, amount: number) {
  return withReservationAmounts(
    note,
    amount,
    reservationBreakfastFee({ special_notes: note }),
  );
}

export function reservationTax(row: Pick<Reservation, "special_notes">) {
  const note = row.special_notes ?? "";
  const lodging = firstAmount(note, [/宿泊税:\s*[¥￥]?\s*([0-9,]+)円?/]) ?? 0;
  const consumption = firstAmount(note, [/消費税:\s*[¥￥]?\s*([0-9,]+)円?/]) ?? 0;
  return { lodging, consumption, total: lodging + consumption };
}
