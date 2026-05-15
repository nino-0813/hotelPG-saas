/**
 * LINE Messaging API — broadcast text to everyone who follows the official account.
 * Env: LINE_CHANNEL_ACCESS_TOKEN only (no user IDs required).
 */

const LINE_BROADCAST_URL = "https://api.line.me/v2/bot/message/broadcast";

export function getLineChannelAccessToken(): string | null {
  const t = process.env.LINE_CHANNEL_ACCESS_TOKEN?.trim();
  return t && t.length > 0 ? t : null;
}

export async function sendLineBroadcastText(
  text: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const token = getLineChannelAccessToken();
  if (!token) {
    return { ok: false, error: "LINE_CHANNEL_ACCESS_TOKEN is not set" };
  }

  const res = await fetch(LINE_BROADCAST_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      messages: [{ type: "text", text }],
    }),
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    return {
      ok: false,
      error: `LINE ${res.status}: ${errBody.slice(0, 400)}`,
    };
  }

  return { ok: true };
}

export function formatStripeWebReservationLineMessage(args: {
  guestName: string;
  guestEmail: string;
  guestCount: number;
  propertyCode: string;
  roomType: string;
  checkInDate: string;
  checkOutDate: string;
  reservationId: string;
}): string {
  const lines = [
    "【HOTEL PG】公式Webから予約が入りました",
    "",
    `お名前: ${args.guestName || "(未入力)"}`,
    `メール: ${args.guestEmail || "—"}`,
    `人数: ${args.guestCount}名`,
    `物件コード: ${args.propertyCode}`,
    `部屋タイプ(カタログ): ${args.roomType}`,
    `チェックイン: ${args.checkInDate}`,
    `チェックアウト: ${args.checkOutDate}`,
    "",
    `予約ID: ${args.reservationId}`,
  ];
  return lines.join("\n");
}
