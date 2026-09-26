import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { createAuthenticatedSession, setAuthCookies } from "@/lib/auth";
import { getAppUrl } from "@/lib/appUrl";
import {
  exchangeAuthorizationCode,
  getProviderProfile,
  providerRedirectUri,
} from "@/lib/email/oauthProviders";
import { createSignedState, readSignedState } from "@/lib/oauthState";

export const runtime = "nodejs";

const STATE_COOKIE = "sthyra_google_auth_state";
const PENDING_COOKIE = "sthyra_google_signup_pending";

type GoogleAuthState = {
  purpose: "google-auth";
  mode: "login" | "signup";
  codeVerifier: string;
};

function destination(request: NextRequest, path: string) {
  return new URL(path, getAppUrl(request));
}

function clearState(response: NextResponse) {
  response.cookies.set(STATE_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/api/auth/google/callback",
    expires: new Date(0),
  });
}

export async function GET(request: NextRequest) {
  const returnedState = request.nextUrl.searchParams.get("state");
  const cookieState = request.cookies.get(STATE_COOKIE)?.value;
  const state =
    returnedState && returnedState === cookieState
      ? readSignedState<GoogleAuthState>(returnedState)
      : null;
  if (!state || state.purpose !== "google-auth") {
    return NextResponse.redirect(destination(request, "/login?oauth_error=invalid_state"));
  }
  const providerError = request.nextUrl.searchParams.get("error");
  const code = request.nextUrl.searchParams.get("code");
  if (providerError || !code) {
    const response = NextResponse.redirect(
      destination(request, `/login?oauth_error=${encodeURIComponent(providerError || "missing_code")}`),
    );
    clearState(response);
    return response;
  }

  try {
    const tokens = await exchangeAuthorizationCode({
      provider: "google",
      code,
      redirectUri: providerRedirectUri(request, "google", "auth"),
      codeVerifier: state.codeVerifier,
    });
    const profile = await getProviderProfile("google", tokens.accessToken);
    if (!profile.emailVerified) {
      throw new Error("Google has not verified this email address");
    }
    const existing = await pool.query(
      `SELECT u.user_id
       FROM users u
       LEFT JOIN auth_identities ai ON ai.user_id=u.user_id AND ai.provider='google'
       WHERE u.deleted_at IS NULL
         AND u.is_active=TRUE
         AND (ai.provider_subject=$1 OR (ai.provider_subject IS NULL AND LOWER(u.email)=LOWER($2)))
       ORDER BY CASE WHEN ai.provider_subject=$1 THEN 0 ELSE 1 END
       LIMIT 1`,
      [profile.accountId, profile.email],
    );

    if (existing.rowCount) {
      const userId = String(existing.rows[0].user_id);
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(
          `INSERT INTO auth_identities (user_id, provider, provider_subject, provider_email)
           VALUES ($1, 'google', $2, $3)
           ON CONFLICT (provider, provider_subject) DO UPDATE
           SET provider_email=EXCLUDED.provider_email, updated_at=CURRENT_TIMESTAMP`,
          [userId, profile.accountId, profile.email],
        );
        const session = await createAuthenticatedSession(client, request, userId);
        await client.query(
          "UPDATE users SET last_login=CURRENT_TIMESTAMP WHERE user_id=$1",
          [userId],
        );
        await client.query("COMMIT");
        const response = NextResponse.redirect(destination(request, "/dashboard"));
        clearState(response);
        setAuthCookies(response, session.accessToken, session.refreshToken);
        return response;
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    }

    const pending = createSignedState(
      {
        purpose: "google-signup" as const,
        subject: profile.accountId,
        email: profile.email,
        name: profile.displayName,
      },
      20 * 60,
    );
    const response = NextResponse.redirect(destination(request, "/signup?google=1"));
    clearState(response);
    response.cookies.set(PENDING_COOKIE, pending, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      path: "/",
      maxAge: 20 * 60,
    });
    return response;
  } catch (error) {
    console.error("Google authentication callback failed", error);
    const response = NextResponse.redirect(
      destination(request, "/login?oauth_error=google_failed"),
    );
    clearState(response);
    return response;
  }
}
