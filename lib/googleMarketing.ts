import { NextRequest } from "next/server";
import { adminPool } from "@/lib/db";
import { getAppUrl } from "@/lib/appUrl";
import {
  decryptIntegrationToken,
  encryptIntegrationToken,
} from "@/lib/integrationTokenEncryption";

const SCOPE = "https://www.googleapis.com/auth/datamanager";

function googleCredentials() {
  const clientId = process.env.GOOGLE_MARKETING_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_MARKETING_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    throw new Error("Google marketing OAuth is not configured");
  }
  return { clientId, clientSecret };
}

export function googleMarketingRedirectUri(request: NextRequest) {
  return (
    process.env.GOOGLE_MARKETING_REDIRECT_URI?.trim() ||
    new URL("/api/marketing/google/callback", getAppUrl(request)).toString()
  );
}

export function googleMarketingAuthorizationUrl(
  request: NextRequest,
  state: string,
) {
  const { clientId } = googleCredentials();
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", googleMarketingRedirectUri(request));
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", SCOPE);
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("include_granted_scopes", "true");
  url.searchParams.set("state", state);
  return url;
}

export async function exchangeGoogleMarketingCode(
  request: NextRequest,
  code: string,
) {
  const { clientId, clientSecret } = googleCredentials();
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      grant_type: "authorization_code",
      redirect_uri: googleMarketingRedirectUri(request),
    }),
    cache: "no-store",
  });
  const body = (await response.json()) as Record<string, unknown>;
  if (!response.ok || typeof body.access_token !== "string") {
    throw new Error(String(body.error_description ?? body.error ?? "Google token exchange failed"));
  }
  return {
    accessToken: body.access_token,
    refreshToken: typeof body.refresh_token === "string" ? body.refresh_token : null,
    expiresAt: new Date(Date.now() + Number(body.expires_in ?? 3600) * 1000),
    scopes: typeof body.scope === "string" ? body.scope.split(" ").filter(Boolean) : [SCOPE],
  };
}

async function refreshGoogleMarketingToken(refreshToken: string) {
  const { clientId, clientSecret } = googleCredentials();
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
    cache: "no-store",
  });
  const body = (await response.json()) as Record<string, unknown>;
  if (!response.ok || typeof body.access_token !== "string") {
    throw new Error(String(body.error_description ?? body.error ?? "Google token refresh failed"));
  }
  return {
    accessToken: body.access_token,
    expiresAt: new Date(Date.now() + Number(body.expires_in ?? 3600) * 1000),
  };
}

export async function validGoogleMarketingAccessToken(
  integration: Record<string, unknown>,
) {
  const expiresAt = integration.access_token_expires_at
    ? new Date(String(integration.access_token_expires_at)).getTime()
    : 0;
  if (
    typeof integration.access_token_ciphertext === "string" &&
    expiresAt > Date.now() + 5 * 60 * 1000
  ) {
    return decryptIntegrationToken(integration.access_token_ciphertext);
  }
  if (typeof integration.refresh_token_ciphertext !== "string") {
    throw new Error("Google connection has no refresh token");
  }
  const refreshed = await refreshGoogleMarketingToken(
    decryptIntegrationToken(integration.refresh_token_ciphertext),
  );
  await adminPool.query(
    `UPDATE marketing_integrations
     SET access_token_ciphertext=$2, access_token_expires_at=$3,
         status='connected', last_error=NULL, updated_at=CURRENT_TIMESTAMP
     WHERE integration_id=$1`,
    [
      integration.integration_id,
      encryptIntegrationToken(refreshed.accessToken),
      refreshed.expiresAt,
    ],
  );
  return refreshed.accessToken;
}

