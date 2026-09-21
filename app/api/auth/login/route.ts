import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import {
  AUTH_USER_COLUMNS,
  createAccessToken,
  createOpaqueToken,
  getRequestIp,
  hashToken,
  REFRESH_TOKEN_DAYS,
  setAuthCookies,
  verifyPassword,
} from "@/lib/auth";
import { validateLoginPayload } from "@/lib/authValidation";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Request body must contain valid JSON" },
      { status: 400 },
    );
  }

  const validation = validateLoginPayload(body);
  if (!validation.ok) {
    return NextResponse.json(
      { error: "Validation failed", details: validation.errors },
      { status: 422 },
    );
  }

  const { identifier, password } = validation.data;
  try {
    const result = await pool.query(
      `SELECT ${AUTH_USER_COLUMNS}, u.password_hash
       FROM users u
       WHERE (LOWER(u.email) = LOWER($1) OR LOWER(u.username) = LOWER($1))
         AND u.deleted_at IS NULL
       LIMIT 1`,
      [identifier],
    );
    const user = result.rows[0];
    const passwordMatches = await verifyPassword(
      password,
      user?.password_hash ?? null,
    );
    if (!user || !user.is_active || !passwordMatches) {
      return NextResponse.json(
        { error: "Invalid username/email or password" },
        { status: 401 },
      );
    }

    const refreshToken = createOpaqueToken();
    const client = await pool.connect();
    let accessToken: string;
    try {
      await client.query("BEGIN");
      const sessionResult = await client.query(
        `INSERT INTO auth_sessions (
           user_id,
           refresh_token_hash,
           user_agent,
           ip_address,
           expires_at
         )
         VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP + ($5 * INTERVAL '1 day'))
         RETURNING session_id`,
        [
          user.user_id,
          hashToken(refreshToken),
          request.headers.get("user-agent"),
          getRequestIp(request),
          REFRESH_TOKEN_DAYS,
        ],
      );
      const sessionId = sessionResult.rows[0].session_id as string;
      accessToken = createAccessToken(user.user_id, sessionId);
      await client.query(
        "UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE user_id = $1",
        [user.user_id],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }

    delete user.password_hash;
    const response = NextResponse.json({ message: "Login successful", user });
    response.headers.set("Cache-Control", "no-store");
    setAuthCookies(response, accessToken, refreshToken);
    return response;
  } catch (error) {
    console.error("Failed to log in", error);
    return NextResponse.json({ error: "Unable to log in" }, { status: 500 });
  }
}
