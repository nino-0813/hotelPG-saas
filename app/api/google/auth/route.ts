import { NextResponse } from "next/server";
import {
  createGoogleOAuth2Client,
  getGoogleClientCredentials,
} from "@/lib/google-auth";

export const runtime = "nodejs";

export async function GET() {
  try {
    const { clientId, clientSecret } = getGoogleClientCredentials();
    if (!clientId || !clientSecret) {
      console.error("[google/auth] Missing GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET");
      return NextResponse.json(
        { error: "OAuth クライアント資格情報が未設定です" },
        { status: 500 },
      );
    }

    const oauth2Client = createGoogleOAuth2Client();

    const url = oauth2Client.generateAuthUrl({
      access_type: "offline",
      prompt: "consent",
      scope: ["https://www.googleapis.com/auth/gmail.send"],
    });

    return NextResponse.redirect(url);
  } catch (e) {
    console.error("[google/auth]", e);
    return NextResponse.json({ error: "OAuth URL の生成に失敗しました" }, { status: 500 });
  }
}
