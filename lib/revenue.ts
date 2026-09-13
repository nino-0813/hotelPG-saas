import type { Reservation } from "@/lib/types/database";

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
  return 0;
}

export function reservationRevenue(row: Pick<Reservation, "special_notes">) {
  const note = row.special_notes ?? "";
  return firstAmount(note, [
    /売上金額:\s*[¥￥]?\s*([0-9,]+)円?/,
    /宿泊売上目標:\s*[¥￥]?\s*([0-9,]+)円?/,
    /料金:\s*[¥￥]?\s*([0-9,]+)[円-]?/,
    /請求額:\s*[¥￥]?\s*([0-9,]+)円?/,
    /[¥￥]\s*([0-9,]+)[円-]?/,
  ]);
}

export function withRevenueAmount(note: string, amount: number) {
  const cleaned = note
    .replace(/^売上金額:\s*[¥￥]?\s*[0-9,]+円?\s*\n?/m, "")
    .trim();
  return amount > 0
    ? `売上金額: ${Math.round(amount).toLocaleString("ja-JP")}円${cleaned ? `\n${cleaned}` : ""}`
    : cleaned;
}

export function reservationTax(row: Pick<Reservation, "special_notes">) {
  const note = row.special_notes ?? "";
  const lodging = firstAmount(note, [/宿泊税:\s*[¥￥]?\s*([0-9,]+)円?/]);
  const consumption = firstAmount(note, [/消費税:\s*[¥￥]?\s*([0-9,]+)円?/]);
  return { lodging, consumption, total: lodging + consumption };
}
