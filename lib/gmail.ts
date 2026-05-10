import { google } from "googleapis";
import {
  createGoogleOAuth2Client,
  getGoogleClientCredentials,
} from "@/lib/google-auth";

function base64UrlEncodeUtf8(raw: string): string {
  return Buffer.from(raw, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/**
 * Gmail API でプレーンテキストメールを送信する。
 * 日本語件名は RFC2047 (encoded-word) で送信する。
 */
export async function sendMail(
  to: string,
  subject: string,
  message: string,
  options?: { from?: string | null },
): Promise<{ id?: string | null }> {
  const { refreshToken } = getGoogleClientCredentials();
  if (!refreshToken) {
    throw new Error(
      "GOOGLE_REFRESH_TOKEN (または GMAIL_REFRESH_TOKEN) が設定されていません",
    );
  }

  const oauth2Client = createGoogleOAuth2Client();
  oauth2Client.setCredentials({ refresh_token: refreshToken });

  const gmail = google.gmail({ version: "v1", auth: oauth2Client });

  const utf8Subject = `=?UTF-8?B?${Buffer.from(subject, "utf8").toString("base64")}?=`;

  const defaultFrom =
    options?.from ??
    process.env.GMAIL_SENDER_EMAIL ??
    process.env.GOOGLE_SENDER_EMAIL ??
    undefined;

  const lines = [
    ...(defaultFrom ? [`From: ${defaultFrom}`] : []),
    `To: ${to}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    `Subject: ${utf8Subject}`,
    "",
    message,
  ];
  const email = lines.join("\r\n");

  const raw = base64UrlEncodeUtf8(email);

  const result = await gmail.users.messages.send({
    userId: "me",
    requestBody: { raw },
  });

  return { id: result.data.id };
}
