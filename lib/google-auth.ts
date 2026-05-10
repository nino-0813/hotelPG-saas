import { google } from "googleapis";

/** OAuth redirect URI registered in Google Cloud Console */
export function getGoogleOAuthRedirectUri(): string {
  return (
    process.env.GOOGLE_OAUTH_REDIRECT_URI ??
    "https://hotel-pg-saas.vercel.app/api/google/callback"
  );
}

export function getGoogleClientCredentials(): {
  clientId: string | undefined;
  clientSecret: string | undefined;
  refreshToken: string | undefined;
} {
  return {
    clientId:
      process.env.GOOGLE_CLIENT_ID ?? process.env.GMAIL_CLIENT_ID ?? undefined,
    clientSecret:
      process.env.GOOGLE_CLIENT_SECRET ??
      process.env.GMAIL_CLIENT_SECRET ??
      undefined,
    refreshToken:
      process.env.GOOGLE_REFRESH_TOKEN ??
      process.env.GMAIL_REFRESH_TOKEN ??
      undefined,
  };
}

export function createGoogleOAuth2Client() {
  const { clientId, clientSecret } = getGoogleClientCredentials();
  if (!clientId || !clientSecret) {
    throw new Error(
      "Google OAuth クライアント資格情報がありません (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET または GMAIL_* )",
    );
  }
  return new google.auth.OAuth2(
    clientId,
    clientSecret,
    getGoogleOAuthRedirectUri(),
  );
}
