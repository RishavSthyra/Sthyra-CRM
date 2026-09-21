import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { authenticateRequest, clearAuthCookies } from "@/lib/auth";

export async function POST(request: NextRequest) {
  const authentication = await authenticateRequest(request);
  if (!authentication.ok) {
    return authentication.response;
  }

  try {
    await pool.query(
      `UPDATE auth_sessions
       SET revoked_at = COALESCE(revoked_at, CURRENT_TIMESTAMP),
           updated_at = CURRENT_TIMESTAMP
       WHERE user_id = $1 AND revoked_at IS NULL`,
      [authentication.auth.user.user_id],
    );
    const response = NextResponse.json({
      message: "Logged out from all sessions",
    });
    clearAuthCookies(response);
    return response;
  } catch (error) {
    console.error("Failed to log out all sessions", error);
    return NextResponse.json(
      { error: "Unable to log out all sessions" },
      { status: 500 },
    );
  }
}
