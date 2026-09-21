import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { authenticateRequest } from "@/lib/auth";

export async function GET(request: NextRequest) {
  const authentication = await authenticateRequest(request);
  if (!authentication.ok) {
    return authentication.response;
  }

  try {
    const result = await pool.query(
      `SELECT
         session_id,
         user_agent,
         ip_address,
         expires_at,
         last_used_at,
         created_at,
         session_id = $2 AS is_current
       FROM auth_sessions
       WHERE user_id = $1
         AND revoked_at IS NULL
         AND expires_at > CURRENT_TIMESTAMP
       ORDER BY created_at DESC`,
      [authentication.auth.user.user_id, authentication.auth.sessionId],
    );
    const response = NextResponse.json({ sessions: result.rows });
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error) {
    console.error("Failed to list sessions", error);
    return NextResponse.json(
      { error: "Unable to retrieve sessions" },
      { status: 500 },
    );
  }
}
