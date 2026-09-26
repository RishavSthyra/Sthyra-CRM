import { createHash, randomBytes } from "node:crypto";
import type { NextRequest } from "next/server";
import { getAppUrl } from "@/lib/appUrl";

export type EmailProvider = "google" | "microsoft";

export type OAuthTokens = {
  accessToken: string;
  refreshToken?: string;
  expiresAt: Date;
  scopes: string[];
  idToken?: string;
};

export type ProviderProfile = {
  accountId: string;
  email: string;
  displayName: string | null;
  emailVerified?: boolean;
};

export function createPkcePair() {
  const verifier = randomBytes(48).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

export function providerRedirectUri(
  request: NextRequest,
  provider: EmailProvider,
  purpose: "auth" | "mailbox",
): string {
  const explicit =
    purpose === "auth"
      ? process.env.GOOGLE_AUTH_REDIRECT_URI
      : provider === "google"
        ? process.env.GOOGLE_EMAIL_REDIRECT_URI
        : process.env.MICROSOFT_EMAIL_REDIRECT_URI;
  if (explicit) return explicit;
  return purpose === "auth"
    ? `${getAppUrl(request)}/api/auth/google/callback`
    : `${getAppUrl(request)}/api/email-connections/${provider}/callback`;
}

export function getAuthorizationUrl(args: {
  provider: EmailProvider;
  purpose: "auth" | "mailbox";
  redirectUri: string;
  state: string;
  codeChallenge: string;
}): string {
  if (args.provider === "google") {
    const scopes =
      args.purpose === "auth"
        ? ["openid", "email", "profile"]
        : [
            "openid",
            "email",
            "profile",
            "https://www.googleapis.com/auth/gmail.send",
          ];
    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    url.search = new URLSearchParams({
      client_id: required("GOOGLE_CLIENT_ID"),
      redirect_uri: args.redirectUri,
      response_type: "code",
      scope: scopes.join(" "),
      state: args.state,
      include_granted_scopes: "true",
      access_type: args.purpose === "mailbox" ? "offline" : "online",
      prompt: args.purpose === "mailbox" ? "consent select_account" : "select_account",
      code_challenge: args.codeChallenge,
      code_challenge_method: "S256",
    }).toString();
    return url.toString();
  }

  const tenant = process.env.MICROSOFT_TENANT_ID?.trim() || "common";
  const url = new URL(
    `https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/authorize`,
  );
  url.search = new URLSearchParams({
    client_id: required("MICROSOFT_CLIENT_ID"),
    redirect_uri: args.redirectUri,
    response_type: "code",
    response_mode: "query",
    scope: "openid profile email offline_access https://graph.microsoft.com/Mail.Send",
    state: args.state,
    prompt: "select_account",
    code_challenge: args.codeChallenge,
    code_challenge_method: "S256",
  }).toString();
  return url.toString();
}

export async function exchangeAuthorizationCode(args: {
  provider: EmailProvider;
  code: string;
  redirectUri: string;
  codeVerifier: string;
}): Promise<OAuthTokens> {
  const google = args.provider === "google";
  const tenant = process.env.MICROSOFT_TENANT_ID?.trim() || "common";
  const endpoint = google
    ? "https://oauth2.googleapis.com/token"
    : `https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/token`;
  const params = new URLSearchParams({
    client_id: required(google ? "GOOGLE_CLIENT_ID" : "MICROSOFT_CLIENT_ID"),
    client_secret: required(
      google ? "GOOGLE_CLIENT_SECRET" : "MICROSOFT_CLIENT_SECRET",
    ),
    code: args.code,
    redirect_uri: args.redirectUri,
    grant_type: "authorization_code",
    code_verifier: args.codeVerifier,
  });
  if (!google) {
    params.set(
      "scope",
      "openid profile email offline_access https://graph.microsoft.com/Mail.Send",
    );
  }
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params,
    cache: "no-store",
  });
  const payload = (await response.json()) as Record<string, unknown>;
  if (!response.ok || typeof payload.access_token !== "string") {
    throw new Error(
      typeof payload.error_description === "string"
        ? payload.error_description
        : "The identity provider rejected the authorization code",
    );
  }
  return {
    accessToken: payload.access_token,
    refreshToken:
      typeof payload.refresh_token === "string"
        ? payload.refresh_token
        : undefined,
    expiresAt: new Date(Date.now() + Number(payload.expires_in || 3600) * 1000),
    scopes: String(payload.scope || "")
      .split(/\s+/)
      .filter(Boolean),
    idToken: typeof payload.id_token === "string" ? payload.id_token : undefined,
  };
}

export async function getProviderProfile(
  provider: EmailProvider,
  accessToken: string,
): Promise<ProviderProfile> {
  const response = await fetch(
    provider === "google"
      ? "https://openidconnect.googleapis.com/v1/userinfo"
      : "https://graph.microsoft.com/v1.0/me?$select=id,displayName,mail,userPrincipalName",
    {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    },
  );
  const payload = (await response.json()) as Record<string, unknown>;
  if (!response.ok) throw new Error("Unable to read the connected account profile");
  const email = String(
    provider === "google"
      ? payload.email || ""
      : payload.mail || payload.userPrincipalName || "",
  ).toLowerCase();
  const accountId = String(provider === "google" ? payload.sub || "" : payload.id || "");
  if (!email || !accountId) {
    throw new Error("The connected account did not provide an email identity");
  }
  return {
    accountId,
    email,
    displayName:
      String(provider === "google" ? payload.name || "" : payload.displayName || "") ||
      null,
    emailVerified:
      provider === "google" ? payload.email_verified === true : undefined,
  };
}
