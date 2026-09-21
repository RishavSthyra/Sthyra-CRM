import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { authenticateRequest, clearAuthCookies } from "@/lib/auth";
import { isUuid } from "@/lib/permissions";

type SessionContext = {
  params: Promise<{ sessionid: string }>;
};

export async function DELETE(request: NextRequest, context: SessionContext) {
  const authentication = await authenticateRequest(request);
  if (!authentication.ok) {
    return authentication.response;
  }

  const { sessionid } = await context.params;
  if (!isUuid(sessionid)) {
    return NextResponse.json(
      { error: "sessionId must be a valid UUID" },
      { status: 400 },
    );
  }

  try {
    const result = await pool.query(
      `UPDATE auth_sessions
       SET revoked_at = COALESCE(revoked_at, CURRENT_TIMESTAMP),
           updated_at = CURRENT_TIMESTAMP
       WHERE session_id = $1
         AND user_id = $2
         AND revoked_at IS NULL
       RETURNING session_id`,
      [sessionid, authentication.auth.user.user_id],
    );
    if (result.rowCount === 0) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    const response = NextResponse.json({ message: "Session revoked" });
    if (sessionid === authentication.auth.sessionId) {
      clearAuthCookies(response);
    }
    return response;
  } catch (error) {
    console.error("Failed to revoke session", error);
    return NextResponse.json(
      { error: "Unable to revoke session" },
      { status: 500 },
    );
  }
}
