import { format, parseISO } from "date-fns";
import { ja } from "date-fns/locale";
import { roomTypeLabel } from "@/lib/room-type-labels";
import type { RoomType } from "@/lib/types/database";

/**
 * 予約確定メールの文面ビルダー（DB非依存・純粋関数）。
 * 管理画面の手動送信（reservations/actions.ts）と Stripe webhook の自動送信で
 * 同一の件名・本文を使うために共有する。
 */

export const RESERVATION_CONFIRMED_SUBJECT = "【HOTEL PG】ご予約が確定しました";

export function propertyLabelFromCode(code: string | null | undefined): string {
  if (code === "PG1") return "HOTEL PG I";
  if (code === "PG2") return "HOTEL PG II";
  if (code === "PG3") return "HOTEL PG III";
  return "HOTEL PG";
}

export function formatJaYmd(isoDate: string): string {
  return format(parseISO(isoDate), "yyyy年M月d日", { locale: ja });
}

export function reservationConfirmedPaymentLine(
  paymentMethod: string | null | undefined,
): string {
  if (paymentMethod === "onsite") {
    return "現地決済（当日ご精算）";
  }
  return "オンラインにて決済済み（金額は決済完了メール・ご利用明細をご確認ください）";
}

export function reservationConfirmedOpeningLine(
  paymentMethod: string | null | undefined,
): string {
  if (paymentMethod === "onsite") {
    return "以下の内容でご予約が確定いたしました。";
  }
  return "決済が完了し、以下の内容でご予約が確定いたしました。";
}

export function roomTypeLineFromReservationRow(r: {
  rooms?: unknown;
  requested_room_type: RoomType | null;
}): string {
  const raw = r.rooms;
  const row = Array.isArray(raw) ? raw[0] : raw;
  const fromRoom =
    row &&
    typeof row === "object" &&
    "room_type" in row &&
    typeof (row as { room_type: unknown }).room_type === "string"
      ? ((row as { room_type: string }).room_type as RoomType)
      : null;
  const t = fromRoom ?? r.requested_room_type;
  return t ? roomTypeLabel(t) : "—";
}

export function splitReservationRoomJoin(r: { rooms?: unknown }): {
  propCode?: string;
  roomNumber: string | null;
} {
  const raw = r.rooms;
  const row = Array.isArray(raw) ? raw[0] : raw;
  if (!row || typeof row !== "object") {
    return { roomNumber: null };
  }
  const room_number =
    "room_number" in row && typeof row.room_number === "string"
      ? row.room_number
      : null;
  const props = "properties" in row ? row.properties : undefined;
  let propCode: string | undefined;
  if (props && typeof props === "object") {
    if (Array.isArray(props)) {
      const c = props[0];
      if (c && typeof c === "object" && "code" in c) {
        propCode = String((c as { code: string }).code);
      }
    } else if ("code" in props) {
      propCode = String((props as { code: string }).code);
    }
  }
  return { propCode, roomNumber: room_number };
}

export function buildReservationConfirmedBody(args: {
  guestName: string;
  openingLine: string;
  facilityLine: string;
  checkInJa: string;
  checkOutJa: string;
  guestCount: number;
  roomTypeLine: string;
  paymentLine: string;
}): string {
  return [
    `${args.guestName} 様`,
    "",
    "この度は HOTEL PG をご予約いただき、誠にありがとうございます。",
    "",
    args.openingLine,
    "",
    "【ご予約内容】",
    `宿泊施設：${args.facilityLine}`,
    `チェックイン日：${args.checkInJa}`,
    `チェックアウト日：${args.checkOutJa}`,
    `宿泊人数：${args.guestCount}名`,
    `お部屋タイプ：${args.roomTypeLine}`,
    `お支払い金額：${args.paymentLine}`,
    "",
    "チェックイン方法・お部屋番号・ロック解除番号などの詳しいご案内は、チェックイン日の4〜5日前を目安に、改めてメールにてお送りいたします。",
    "",
    "当ホテルでは、フロントを設けておらず、常駐スタッフもおりません。",
    "そのため、事前にお送りするチェックイン案内をご確認のうえ、セルフチェックインをお願いいたします。",
    "",
    "ご予約内容の変更やご不明点がございましたら、お早めにご連絡ください。",
    "070-8328-9154",
    "",
    "因島でのご滞在を、心よりお待ちしております。",
    "",
    "HOTEL PG",
  ].join("\n");
}

export type ReservationConfirmedEmailRow = {
  guest_name: string;
  guest_email: string | null;
  guest_count: number;
  check_in_date: string;
  check_out_date: string;
  payment_method: string | null;
  requested_room_type: RoomType | null;
  rooms?: unknown;
};

/**
 * 予約行（rooms/properties を join 済み）から確定メールの to/subject/body を組み立てる。
 * guest_email 未設定なら error を返す。
 */
export function buildReservationConfirmedEmail(
  r: ReservationConfirmedEmailRow,
): { to: string; subject: string; body: string } | { error: string } {
  if (!r.guest_email) return { error: "メールアドレスが未設定です" };
  const { propCode } = splitReservationRoomJoin(r);
  const body = buildReservationConfirmedBody({
    guestName: r.guest_name,
    openingLine: reservationConfirmedOpeningLine(r.payment_method),
    facilityLine: propertyLabelFromCode(propCode),
    checkInJa: formatJaYmd(r.check_in_date),
    checkOutJa: formatJaYmd(r.check_out_date),
    guestCount: r.guest_count,
    roomTypeLine: roomTypeLineFromReservationRow(r),
    paymentLine: reservationConfirmedPaymentLine(r.payment_method),
  });
  return { to: r.guest_email, subject: RESERVATION_CONFIRMED_SUBJECT, body };
}
