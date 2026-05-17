"use server";

import { revalidatePath } from "next/cache";
import { format, parseISO } from "date-fns";
import { ja } from "date-fns/locale";
import { sendMail } from "@/lib/gmail";
import { roomTypeLabel } from "@/lib/room-type-labels";
import { createClient } from "@/lib/supabase/server";
import { syncAllEnabledCalendars } from "@/lib/ical/sync";
import type {
  PaymentMethod,
  ReservationStatus,
  RoomType,
} from "@/lib/types/database";

export type CreateReservationInput = {
  room_id: string;
  guest_name: string;
  guest_phone?: string;
  guest_count: number;
  check_in_date: string;
  check_in_time?: string;
  check_out_date: string;
  check_out_time?: string;
  payment_method: PaymentMethod;
  smart_key_code?: string;
  special_notes?: string;
  source?: string;
};

export async function createReservation(input: CreateReservationInput) {
  const supabase = await createClient();

  const payload = {
    room_id: input.room_id,
    guest_name: input.guest_name.trim(),
    guest_phone: input.guest_phone?.trim() || null,
    guest_count: input.guest_count,
    check_in_date: input.check_in_date,
    check_in_time: input.check_in_time || "15:00",
    check_out_date: input.check_out_date,
    check_out_time: input.check_out_time || "11:00",
    payment_method: input.payment_method,
    smart_key_code: input.smart_key_code?.trim() || null,
    special_notes: input.special_notes?.trim() || null,
    source: input.source?.trim() || "manual",
    status: "confirmed" as const,
  };

  const { data, error } = await supabase
    .from("reservations")
    .insert(payload)
    .select("id")
    .single();

  console.log("[createReservation] insert result:", { data, error });
  console.log("[createReservation] insert ok:", !error);
  console.log("[createReservation] reservation id:", data?.id ?? null);

  if (error) return { error: error.message };

  if (data?.id) {
    const { error: logErr } = await supabase.from("reservation_logs").insert({
      reservation_id: data.id,
      action: "created",
    });
    if (logErr) console.error("[reservation_logs] insert failed", logErr.message);
  }

  revalidatePath("/reservations");
  revalidatePath("/tasks");
  return { ok: true, id: data?.id };
}

export type UpdateReservationInput = Partial<CreateReservationInput> & {
  id: string;
};

export async function updateReservation(input: UpdateReservationInput) {
  const supabase = await createClient();
  const { id, ...rest } = input;

  const payload: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(rest)) {
    if (v === undefined) continue;
    if (typeof v === "string") {
      payload[k] = v.trim() || null;
    } else {
      payload[k] = v;
    }
  }

  const { error } = await supabase
    .from("reservations")
    .update(payload)
    .eq("id", id);

  if (error) return { error: error.message };

  revalidatePath("/reservations");
  revalidatePath("/tasks");
  revalidatePath("/rooms");
  return { ok: true };
}

export async function moveReservationRoom(input: {
  id: string;
  room_id: string;
}) {
  const supabase = await createClient();

  const { data: r, error: fetchErr } = await supabase
    .from("reservations")
    .select("id, room_id, check_in_date, check_out_date, status, guest_name")
    .eq("id", input.id)
    .single();

  if (fetchErr || !r) return { error: fetchErr?.message ?? "予約が見つかりません" };
  if (r.status === "cancelled") {
    return { error: "キャンセル済みの予約は移動できません" };
  }
  if (!r.room_id) {
    return { error: "部屋未割当の予約は予約一覧の「部屋割当」から割り当ててください" };
  }
  if (r.room_id === input.room_id) {
    return { ok: true as const };
  }

  const { data: overlaps, error: overlapErr } = await supabase
    .from("reservations")
    .select("id, guest_name")
    .eq("room_id", input.room_id)
    .neq("status", "cancelled")
    .neq("id", input.id)
    .lt("check_in_date", r.check_out_date)
    .gt("check_out_date", r.check_in_date);

  if (overlapErr) return { error: overlapErr.message };
  if (overlaps && overlaps.length > 0) {
    const other = overlaps[0].guest_name ?? "他予約";
    return {
      error: `移動先の部屋に重なる予約があります（${other}）`,
    };
  }

  const { error } = await supabase
    .from("reservations")
    .update({ room_id: input.room_id })
    .eq("id", input.id);

  if (error) return { error: error.message };

  revalidatePath("/reservations");
  revalidatePath("/tasks");
  revalidatePath("/rooms");
  return { ok: true as const };
}

export async function changeReservationStatus(
  id: string,
  status: ReservationStatus,
) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("reservations")
    .update({ status })
    .eq("id", id);

  if (error) return { error: error.message };

  revalidatePath("/reservations");
  revalidatePath("/tasks");
  return { ok: true };
}

export async function deleteReservation(id: string) {
  const supabase = await createClient();
  const { error } = await supabase.from("reservations").delete().eq("id", id);

  if (error) return { error: error.message };

  revalidatePath("/reservations");
  revalidatePath("/tasks");
  return { ok: true };
}

export type AssignReservationInput = {
  id: string;
  room_id: string;
  smart_key_code?: string;
  special_notes?: string;
};

/**
 * Assign a room and key code to a pending (room_id = NULL) reservation.
 * The DB trigger fires task generation as soon as room_id transitions to a value.
 */
export async function assignReservationRoom(input: AssignReservationInput) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("reservations")
    .update({
      room_id: input.room_id,
      smart_key_code: input.smart_key_code?.trim() || null,
      special_notes: input.special_notes?.trim() || null,
    })
    .eq("id", input.id);

  if (error) return { error: error.message };

  revalidatePath("/reservations");
  revalidatePath("/tasks");
  return { ok: true };
}

/**
 * Safety: sync external calendars before creating manual reservations.
 * This reduces the chance of double booking due to stale OTA data.
 */
export async function syncExternalCalendars() {
  const supabase = await createClient();
  const results = await syncAllEnabledCalendars(supabase);
  revalidatePath("/reservations");
  revalidatePath("/external-calendars");
  return {
    ok: true as const,
    results,
  };
}

function propertyLabelFromCode(code: string | null | undefined) {
  if (code === "PG1") return "HOTEL PG I";
  if (code === "PG2") return "HOTEL PG II";
  if (code === "PG3") return "HOTEL PG III";
  return "HOTEL PG";
}

function templateFooterContacts() {
  return [
    "",
    "ご不明な点やお困りの際は、お電話またはメッセージにて、サポートいたします。",
    "どうぞお気軽にご連絡ください。",
    "",
    "電話対応は18:00まで",
    "",
    "HOTEL PG -Ⅰ-",
    "住所: 尾道市因島土生町1896-17",
    "旅館業法に基づく営業許可番号: 尾市環指令第301号",
    "電話: 070-8328-9154",
    "チェックイン: 15:00〜18:00 / チェックアウト: 10:00",
    "",
    "HOTEL PG -Ⅱ-",
    "住所: 尾道市因島土生町1896-8",
    "旅館業法に基づく営業許可番号: 尾市環指令第753号",
    "電話: 070-8328-9154",
    "チェックイン: 15:00〜18:00 / チェックアウト: 10:00",
    "",
    "HOTEL PG -Ⅲ-",
    "住所: 広島県尾道市因島土生町1747-5",
    "旅館業法に基づく営業許可番号: 尾市環指令第083142号",
    "電話: 070-8328-9154",
    "チェックイン: 15:00〜18:00 / チェックアウト: 10:00",
  ].join("\n");
}

/** HOTEL PG I エントランス共用ロック（部屋キーとは別） */
const PG1_ENTRANCE_UNLOCK = "4228＊";

function buildCheckInBodyPG1(args: {
  guestName: string;
  checkInDate: string;
  roomNumber: string | null;
  smartKeyCode: string | null;
}) {
  const room = args.roomNumber ?? "◯";
  const roomKey = args.smartKeyCode ? `${args.smartKeyCode}＊` : "◯◯◯◯＊";
  const dateYmd = args.checkInDate.replace(/-/g, "/");

  return [
    "HOTELPG Iチェックインのご案内",
    "",
    `${args.guestName}様`,
    "",
    `この度は HOTEL PG I にご予約いただき、誠にありがとうございます。`,
    `${dateYmd}チェックインのご案内です。`,
    "",
    "当ホテルではフロントを設けておらず、常駐スタッフもおりません。",
    "そのため セルフチェックイン方式 でご案内させていただいております。",
    "チェックインは15:00〜18:00の間でお願いしております。",
    "セルフチェックインの方法につきまして、下記の通りご案内申し上げます。",
    "",
    "■ HOTEL入口のロック解除方法",
    "1.    パネルに手をかざしてください。",
    "2.    表示された2つの数字を押してください。",
    `3.    ロック解除番号「${PG1_ENTRANCE_UNLOCK}」を入力してください。`,
    "",
    "■ ご注意事項",
    "館内は 土足厳禁 となっております。",
    "お手数ですが、下駄箱にご用意しておりますスリッパをご利用ください。",
    "",
    "■ お部屋のご案内",
    `階段を上がって【${room}】のお部屋でございます。`,
    "お部屋のドアも、入口と同じ手順で解除いただけます。",
    "ロック解除番号は 下記の通りです。",
    `PG I【${room}】「${roomKey}」`,
    "",
    "■ お車でお越しのお客様へ",
    "駐車場をご用意させていただくため、お手数ですが お車の種類 をお知らせいただけますと幸いです。",
    "",
    "■ 自転車でお越しのお客様へ",
    "ホテル敷地内に駐車場があります。空いている駐車スペースをご利用下さい。",
    "",
    "■ ご朝食について",
    "ご朝食は、有料でご用意しております。",
    "ホテルの隣の建物にあるおばんざいアゲハ食堂にてお召し上がりいただけます。",
    "営業時間：8:00〜10:00",
    "月・水・金：【洋食】",
    "火・木・土・日：【和食】",
    "料金：880円（税込）",
    templateFooterContacts(),
  ].join("\n");
}

function buildCheckInBodyPG2(args: {
  guestName: string;
  checkInDate: string;
  roomNumber: string | null;
  smartKeyCode: string | null;
}) {
  const room = args.roomNumber ?? "◯";
  const key = args.smartKeyCode ?? "◯◯◯◯";
  const dateYmd = args.checkInDate.replace(/-/g, "/");

  const pg2Meta = (() => {
    const r = (room ?? "").trim().toUpperCase();
    const colorMap: Record<string, string> = {
      A: "黒",
      B: "青",
      C: "オレンジ",
      D: "グレー",
      E: "緑",
    };
    const floor = r === "A" || r === "B" ? "2階" : r ? "1階" : "◯階";
    const color = colorMap[r] ?? "◯色";
    return { floor, color };
  })();

  return [
    "HOTELPG II チェックインのご案内",
    "",
    `${args.guestName}様`,
    "",
    `この度は HOTEL PG II にご予約いただき、誠にありがとうございます。`,
    `${dateYmd}チェックインのご案内です。`,
    "",
    "当ホテルではフロントを設けておらず、常駐スタッフもおりません。",
    "そのため セルフチェックイン方式 でご案内させていただいております。",
    "チェックインは15:00〜18:00の間でお願いしております。",
    "当ホテル1階エントランスにキーボックスを設けておりますので、下記をご参照下さいませ。",
    "",
    "■ チェックインのご案内",
    "ご到着されましたら、HOTEL PG II 1階、一番手前の入口 からエントランスへお入りください。",
    "エントランスにお進みいただきますと、階段の手すりに キーボックスが5つ 設置されております。",
    `このうち 「${pg2Meta.color}」のキーボックス にお客様のお部屋の鍵が入っております。`,
    `・解錠番号：${key}`,
    `・お部屋：PG II ${pg2Meta.floor}【${room}】`,
    "※ 2階へはエントランスからお上がり下さい。その際、土足厳禁となっております。靴を脱いでお上がりいただくようになりますので、ご注意ください。",
    "",
    "■ チェックアウトについて",
    "チェックアウトは、鍵を同じキーボックスにご返却いただくだけで完了となります。",
    "",
    "■ お車でお越しのお客様へ",
    "駐車場をご用意するため、",
    "お車の種類を事前にお知らせいただきますよう、ご協力をお願いいたします。",
    "",
    "■ 自転車でお越しのお客様へ",
    "ホテル敷地内に駐車場があります。空いている駐車スペースをご利用下さい。",
    "",
    "■ ご朝食について",
    "ご朝食は、有料でご用意しております。",
    "ホテルの隣の建物にあるおばんざいアゲハ食堂にてお召し上がりいただけます。",
    "営業時間：8:00〜10:00",
    "月・水・金：【洋食】",
    "火・木・土・日：【和食】",
    "料金：880円（税込）",
    templateFooterContacts(),
  ].join("\n");
}

export type GuestEmailDraft = {
  to: string;
  subject: string;
  body: string;
  from: string;
  mailKind: "check_in" | "reservation_confirmed";
};

function formatJaYmd(isoDate: string): string {
  return format(parseISO(isoDate), "yyyy年M月d日", { locale: ja });
}

function reservationConfirmedPaymentLine(
  paymentMethod: string | null | undefined,
): string {
  if (paymentMethod === "onsite") {
    return "現地決済（当日ご精算）";
  }
  return "オンラインにて決済済み（金額は決済完了メール・ご利用明細をご確認ください）";
}

function reservationConfirmedOpeningLine(
  paymentMethod: string | null | undefined,
): string {
  if (paymentMethod === "onsite") {
    return "以下の内容でご予約が確定いたしました。";
  }
  return "決済が完了し、以下の内容でご予約が確定いたしました。";
}

function roomTypeLineFromReservationRow(r: {
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

function buildReservationConfirmedBody(args: {
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

function splitReservationRoomJoin(r: {
  rooms?: unknown;
}): { propCode?: string; roomNumber: string | null } {
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

async function buildReservationConfirmedEmailDraft(
  reservationId: string,
): Promise<{ draft?: GuestEmailDraft; error?: string }> {
  const supabase = await createClient();
  const { data: r, error } = await supabase
    .from("reservations")
    .select(
      "id, guest_name, guest_email, guest_count, check_in_date, check_out_date, payment_method, requested_room_type, rooms(room_number, room_type, properties(code))",
    )
    .eq("id", reservationId)
    .single();

  if (error || !r) return { error: error?.message ?? "予約が見つかりません" };
  if (!r.guest_email) return { error: "メールアドレスが未設定です" };

  const from = process.env.GMAIL_SENDER_EMAIL || "me";
  const { propCode } = splitReservationRoomJoin(r);
  const facilityLine = propertyLabelFromCode(propCode);
  const subject = "【HOTEL PG】ご予約が確定しました";
  const body = buildReservationConfirmedBody({
    guestName: r.guest_name,
    openingLine: reservationConfirmedOpeningLine(r.payment_method),
    facilityLine,
    checkInJa: formatJaYmd(r.check_in_date),
    checkOutJa: formatJaYmd(r.check_out_date),
    guestCount: r.guest_count,
    roomTypeLine: roomTypeLineFromReservationRow(r),
    paymentLine: reservationConfirmedPaymentLine(r.payment_method),
  });

  return {
    draft: {
      to: r.guest_email,
      subject,
      body,
      from,
      mailKind: "reservation_confirmed",
    },
  };
}

async function buildCheckInEmailDraft(
  reservationId: string,
): Promise<{ draft?: GuestEmailDraft; error?: string }> {
  const supabase = await createClient();
  const { data: r, error } = await supabase
    .from("reservations")
    .select(
      "id, guest_name, guest_email, check_in_date, check_in_time, check_out_date, check_out_time, smart_key_code, room_id, rooms(room_number, properties(code))",
    )
    .eq("id", reservationId)
    .single();

  if (error || !r) return { error: error?.message ?? "予約が見つかりません" };
  if (!r.guest_email) return { error: "メールアドレスが未設定です" };

  const from = process.env.GMAIL_SENDER_EMAIL || "me";
  const { propCode, roomNumber } = splitReservationRoomJoin(r);
  const subject = `【${propertyLabelFromCode(propCode)}】チェックインのご案内`;

  const body =
    propCode === "PG2"
      ? buildCheckInBodyPG2({
          guestName: r.guest_name,
          checkInDate: r.check_in_date,
          roomNumber,
          smartKeyCode: r.smart_key_code,
        })
      : buildCheckInBodyPG1({
          guestName: r.guest_name,
          checkInDate: r.check_in_date,
          roomNumber,
          smartKeyCode: r.smart_key_code,
        });

  return {
    draft: {
      to: r.guest_email,
      subject,
      body,
      from,
      mailKind: "check_in",
    },
  };
}

export async function getCheckInEmailDraft(reservationId: string) {
  return await buildCheckInEmailDraft(reservationId);
}

export async function getReservationConfirmedEmailDraft(
  reservationId: string,
) {
  return await buildReservationConfirmedEmailDraft(reservationId);
}

export async function sendCheckInEmail(reservationId: string) {
  const draftRes = await buildCheckInEmailDraft(reservationId);
  if (draftRes.error || !draftRes.draft) return { error: draftRes.error ?? "メールを作成できません" };

  try {
    const fromOverride =
      draftRes.draft.from !== "me" ? draftRes.draft.from : undefined;

    await sendMail(draftRes.draft.to, draftRes.draft.subject, draftRes.draft.body, {
      from: fromOverride ?? null,
    });

    return { ok: true as const };
  } catch (e) {
    console.error("[sendCheckInEmail]", e);
    const msg =
      e instanceof Error ? e.message : "Gmail送信に失敗しました";
    return { error: msg };
  }
}
