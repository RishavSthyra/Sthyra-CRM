import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { getAppUrl } from "@/lib/appUrl";
import { exchangeGoogleMarketingCode } from "@/lib/googleMarketing";
import { encryptIntegrationToken } from "@/lib/integrationTokenEncryption";
import { readSignedState } from "@/lib/oauthState";
import { getUserProjectAccess } from "@/lib/projectAccess";

const COOKIE = "sthyra_marketing_oauth_state";
type State = { purpose: "google-marketing-oauth"; userId: string; companyId: number; integrationId: string };

function redirect(request: NextRequest, key: string, value: string) {
  const url = new URL("/marketing", getAppUrl(request));
  url.searchParams.set(key, value);
  return NextResponse.redirect(url);
}

function clear(response: NextResponse) {
  response.cookies.set(COOKIE, "", { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/api/marketing/google/callback", expires: new Date(0) });
}

export async function GET(request: NextRequest) {
  const returned = request.nextUrl.searchParams.get("state");
  const cookie = request.cookies.get(COOKIE)?.value;
  const state = returned && returned === cookie ? readSignedState<State>(returned) : null;
  if (!state || state.purpose !== "google-marketing-oauth") return redirect(request, "marketing_error", "invalid_state");
  const code = request.nextUrl.searchParams.get("code");
  if (!code || request.nextUrl.searchParams.get("error")) {
    const response = redirect(request, "marketing_error", request.nextUrl.searchParams.get("error") || "missing_code");
    clear(response);
    return response;
  }
  try {
    const access = await getUserProjectAccess(state.userId);
    if (!access || access.company.company_id !== state.companyId || !access.canViewAllProjects) throw new Error("Workspace access changed during authorization");
    const tokens = await exchangeGoogleMarketingCode(request, code);
    const existing = await pool.query(
      `SELECT refresh_token_ciphertext FROM marketing_integrations
       WHERE company_id=$1 AND integration_id=$2 AND provider='google_data_manager'`,
      [state.companyId, state.integrationId],
    );
    if (!existing.rowCount) throw new Error("Integration no longer exists");
    const refresh = tokens.refreshToken ? encryptIntegrationToken(tokens.refreshToken) : existing.rows[0].refresh_token_ciphertext;
    if (!refresh) throw new Error("Google did not return an offline refresh token");
    await pool.query(
      `UPDATE marketing_integrations
       SET access_token_ciphertext=$3, refresh_token_ciphertext=$4,
           access_token_expires_at=$5, scopes=$6, status='connected',
           last_error=NULL, updated_by=$7, updated_at=CURRENT_TIMESTAMP
       WHERE company_id=$1 AND integration_id=$2`,
      [state.companyId, state.integrationId, encryptIntegrationToken(tokens.accessToken), refresh, tokens.expiresAt, tokens.scopes, state.userId],
    );
    const response = redirect(request, "marketing_connected", "google");
    clear(response);
    return response;
  } catch (error) {
    console.error("Google marketing OAuth callback failed", error);
    const response = redirect(request, "marketing_error", "connection_failed");
    clear(response);
    return response;
  }
}

