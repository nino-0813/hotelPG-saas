"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { syncAllEnabledCalendars } from "@/lib/ical/sync";
import type {
  PaymentMethod,
  ReservationStatus,
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
  return { ok: true };
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

function base64UrlEncode(input: string) {
  return Buffer.from(input, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

async function getGmailAccessToken() {
  const clientId = process.env.GMAIL_CLIENT_ID;
  const clientSecret = process.env.GMAIL_CLIENT_SECRET;
  const refreshToken = process.env.GMAIL_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !refreshToken) {
    return { error: "Gmail API環境変数(GMAIL_CLIENT_ID/SECRET/REFRESH_TOKEN)が未設定です" };
  }

  const body = new URLSearchParams();
  body.set("client_id", clientId);
  body.set("client_secret", clientSecret);
  body.set("refresh_token", refreshToken);
  body.set("grant_type", "refresh_token");

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return { error: `Gmailトークン取得に失敗しました: HTTP ${res.status} ${text.slice(0, 200)}` };
  }
  const json = (await res.json()) as { access_token?: string };
  if (!json.access_token) return { error: "Gmailアクセストークンが取得できませんでした" };
  return { accessToken: json.access_token };
}

function buildCheckInEmail({
  to,
  subject,
  body,
  from,
}: {
  to: string;
  subject: string;
  body: string;
  from: string;
}) {
  // Minimal RFC 5322 message
  const raw = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "",
    body,
  ].join("\r\n");
  return raw;
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
    "■HOTELPG I",
    "〒722-2323",
    "広島県尾道市因島土生町1896-17",
    "■HOTEL PGⅡ",
    "〒722-2323",
    "広島県尾道市因島土生町1896-8",
    "TEL：070-8328-9154",
    "電話受付対応時間9:00〜17:00",
  ].join("\n");
}

function buildCheckInBodyPG1(args: {
  guestName: string;
  checkInDate: string;
  roomNumber: string | null;
  smartKeyCode: string | null;
}) {
  const room = args.roomNumber ?? "◯";
  const key = args.smartKeyCode ? `${args.smartKeyCode}＊` : "◯◯◯◯＊";
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
    `3.    ロック解除番号「${key}」を入力してください。`,
    "",
    "■ ご注意事項",
    "館内は 土足厳禁 となっております。",
    "お手数ですが、下駄箱にご用意しておりますスリッパをご利用ください。",
    "",
    "■ お部屋のご案内",
    `階段を上がって【${room}】のお部屋でございます。`,
    "お部屋のドアも、入口と同じ手順で解除いただけます。",
    "ロック解除番号は 下記の通りです。",
    `PG I【${room}】「${key}」`,
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
    "チェックインは15:00以降から可能でございます。",
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

export async function sendCheckInEmail(reservationId: string) {
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
  const propCode = (r as any)?.rooms?.properties?.code as string | undefined;
  const subject = `【${propertyLabelFromCode(propCode)}】チェックインのご案内`;
  const roomNumber = ((r as any)?.rooms?.room_number as string | undefined) ?? null;

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

  const token = await getGmailAccessToken();
  if ("error" in token) return { error: token.error };

  const raw = buildCheckInEmail({
    to: r.guest_email,
    subject,
    body,
    from: from === "me" ? "me" : from,
  });

  const sendRes = await fetch(
    "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${token.accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ raw: base64UrlEncode(raw) }),
    },
  );

  if (!sendRes.ok) {
    const text = await sendRes.text().catch(() => "");
    return { error: `Gmail送信に失敗しました: HTTP ${sendRes.status} ${text.slice(0, 200)}` };
  }

  return { ok: true as const };
}
