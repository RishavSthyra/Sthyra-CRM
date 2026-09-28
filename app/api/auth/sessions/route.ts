import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { authenticateRequest } from "@/lib/auth";
import { isSupabaseAuthConfigured } from "@/lib/supabase/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const authentication = await authenticateRequest(request);
  if (!authentication.ok) {
    return authentication.response;
  }

  if (isSupabaseAuthConfigured()) {
    const supabase = await createSupabaseServerClient();
    const { data } = await supabase.auth.getClaims();
    const issuedAt =
      typeof data?.claims?.iat === "number"
        ? new Date(data.claims.iat * 1000).toISOString()
        : null;
    const expiresAt =
      typeof data?.claims?.exp === "number"
        ? new Date(data.claims.exp * 1000).toISOString()
        : null;
    return NextResponse.json({
      sessions: [
        {
          session_id: authentication.auth.sessionId,
          user_agent: request.headers.get("user-agent"),
          ip_address: null,
          expires_at: expiresAt,
          last_used_at: null,
          created_at: issuedAt,
          is_current: true,
        },
      ],
    });
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
