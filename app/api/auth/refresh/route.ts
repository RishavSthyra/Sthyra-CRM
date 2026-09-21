import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import {
  clearAuthCookies,
  createAccessToken,
  createOpaqueToken,
  getRefreshToken,
  hashToken,
  REFRESH_TOKEN_DAYS,
  setAuthCookies,
} from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const currentToken = getRefreshToken(request);

  if (!currentToken) {
    return NextResponse.json(
      { error: "Refresh token required" },
      { status: 401 },
    );
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const result = await client.query(
      `SELECT s.session_id, s.user_id
       FROM auth_sessions s
       JOIN users u ON u.user_id = s.user_id
       WHERE s.refresh_token_hash = $1
         AND s.revoked_at IS NULL
         AND s.expires_at > CURRENT_TIMESTAMP
         AND u.is_active = TRUE
         AND u.deleted_at IS NULL
       FOR UPDATE OF s`,
      [hashToken(currentToken)],
    );

    if (result.rowCount === 0) {
      await client.query("ROLLBACK");
      const response = NextResponse.json(
        { error: "Refresh token is invalid or expired" },
        { status: 401 },
      );
      clearAuthCookies(response);
      return response;
    }

    const session = result.rows[0];

    const nextRefreshToken = createOpaqueToken();

    await client.query(
      `UPDATE auth_sessions
       SET refresh_token_hash = $1,
           last_used_at = CURRENT_TIMESTAMP,
           expires_at = CURRENT_TIMESTAMP + ($3 * INTERVAL '1 day'),
           updated_at = CURRENT_TIMESTAMP
       WHERE session_id = $2`,
      [hashToken(nextRefreshToken), session.session_id, REFRESH_TOKEN_DAYS],
    );
    const accessToken = createAccessToken(session.user_id, session.session_id);
    await client.query("COMMIT");

    const response = NextResponse.json({ message: "Session refreshed" });
    response.headers.set("Cache-Control", "no-store");
    setAuthCookies(response, accessToken, nextRefreshToken);
    return response;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    console.error("Failed to refresh session", error);
    return NextResponse.json(
      { error: "Unable to refresh session" },
      { status: 500 },
    );
  } finally {
    client.release();
  }
}
