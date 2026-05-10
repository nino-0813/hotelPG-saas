import { NextRequest, NextResponse } from "next/server";
import { createGoogleOAuth2Client } from "@/lib/google-auth";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    const code = req.nextUrl.searchParams.get("code");

    if (!code) {
      return NextResponse.json({ error: "No code" }, { status: 400 });
    }

    const oauth2Client = createGoogleOAuth2Client();
    const { tokens } = await oauth2Client.getToken(code);

    console.log("[google/callback] TOKENS received (refresh_token を Vercel の GOOGLE_REFRESH_TOKEN に設定してください)");

    return NextResponse.json(tokens);
  } catch (error) {
    console.error("[google/callback]", error);

    return NextResponse.json({ error: "OAuth failed" }, { status: 500 });
  }
}
