import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { getAppUrl } from "@/lib/appUrl";
import {
  EmailProvider,
  exchangeAuthorizationCode,
  getProviderProfile,
  providerRedirectUri,
} from "@/lib/email/oauthProviders";
import { encryptEmailToken } from "@/lib/email/tokenEncryption";
import { readSignedState } from "@/lib/oauthState";
import { getUserProjectAccess } from "@/lib/projectAccess";

export const runtime = "nodejs";

const STATE_COOKIE = "sthyra_mailbox_oauth_state";
type MailboxState = {
  purpose: "mailbox-oauth";
  provider: EmailProvider;
  userId: string;
  companyId: number;
  codeVerifier: string;
};

function settingsUrl(request: NextRequest, values: Record<string, string>) {
  const url = new URL("/settings", getAppUrl(request));
  url.searchParams.set("section", "email-accounts");
  for (const [key, value] of Object.entries(values)) url.searchParams.set(key, value);
  return url;
}

function clearState(response: NextResponse, provider: string) {
  response.cookies.set(STATE_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: `/api/email-connections/${provider}/callback`,
    expires: new Date(0),
  });
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ provider: string }> },
) {
  const { provider: providerValue } = await params;
  if (providerValue !== "google" && providerValue !== "microsoft") {
    return NextResponse.json({ error: "Unsupported email provider" }, { status: 404 });
  }
  const provider = providerValue as EmailProvider;
  const returnedState = request.nextUrl.searchParams.get("state");
  const cookieState = request.cookies.get(STATE_COOKIE)?.value;
  const state =
    returnedState && returnedState === cookieState
      ? readSignedState<MailboxState>(returnedState)
      : null;
  if (
    !state ||
    state.purpose !== "mailbox-oauth" ||
    state.provider !== provider
  ) {
    return NextResponse.redirect(settingsUrl(request, { mailbox_error: "invalid_state" }));
  }
  const code = request.nextUrl.searchParams.get("code");
  const providerError = request.nextUrl.searchParams.get("error");
  if (!code || providerError) {
    const response = NextResponse.redirect(
      settingsUrl(request, { mailbox_error: providerError || "missing_code" }),
    );
    clearState(response, provider);
    return response;
  }

  try {
    const access = await getUserProjectAccess(state.userId);
    if (!access || access.company.company_id !== state.companyId) {
      throw new Error("The workspace membership changed during authorization");
    }
    const tokens = await exchangeAuthorizationCode({
      provider,
      code,
      redirectUri: providerRedirectUri(request, provider, "mailbox"),
      codeVerifier: state.codeVerifier,
    });
    const profile = await getProviderProfile(provider, tokens.accessToken);
    const existing = await pool.query(
      `SELECT refresh_token_ciphertext
       FROM email_connections
       WHERE company_id=$1 AND provider=$2 AND provider_account_id=$3`,
      [state.companyId, provider, profile.accountId],
    );
    const refreshCiphertext = tokens.refreshToken
      ? encryptEmailToken(tokens.refreshToken)
      : existing.rows[0]?.refresh_token_ciphertext ?? null;
    if (!refreshCiphertext) {
      throw new Error("The provider did not issue an offline refresh token. Reconnect and grant consent.");
    }
    const defaults = await pool.query(
      `SELECT 1 FROM email_connections
       WHERE user_id=$1 AND status='connected' AND is_default=TRUE`,
      [state.userId],
    );
    await pool.query(
      `INSERT INTO email_connections (
         company_id, user_id, provider, provider_account_id, email_address,
         display_name, access_token_ciphertext, refresh_token_ciphertext,
         access_token_expires_at, scopes, status, is_default, last_error
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'connected',$11,NULL)
       ON CONFLICT (company_id, provider, provider_account_id) DO UPDATE SET
         user_id=EXCLUDED.user_id,
         email_address=EXCLUDED.email_address,
         display_name=EXCLUDED.display_name,
         access_token_ciphertext=EXCLUDED.access_token_ciphertext,
         refresh_token_ciphertext=EXCLUDED.refresh_token_ciphertext,
         access_token_expires_at=EXCLUDED.access_token_expires_at,
         scopes=EXCLUDED.scopes,
         status='connected',
         last_error=NULL,
         updated_at=CURRENT_TIMESTAMP`,
      [
        state.companyId,
        state.userId,
        provider,
        profile.accountId,
        profile.email,
        profile.displayName,
        encryptEmailToken(tokens.accessToken),
        refreshCiphertext,
        tokens.expiresAt,
        tokens.scopes,
        defaults.rowCount === 0,
      ],
    );
    const response = NextResponse.redirect(
      settingsUrl(request, { mailbox_connected: provider }),
    );
    clearState(response, provider);
    return response;
  } catch (error) {
    console.error(`${provider} mailbox OAuth callback failed`, error);
    const response = NextResponse.redirect(
      settingsUrl(request, { mailbox_error: "connection_failed" }),
    );
    clearState(response, provider);
    return response;
  }
}
