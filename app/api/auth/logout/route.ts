import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { clearAuthCookies, getRefreshToken, hashToken } from "@/lib/auth";
import { isSupabaseAuthConfigured } from "@/lib/supabase/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  if (isSupabaseAuthConfigured()) {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.signOut({ scope: "local" });
    if (error) {
      return NextResponse.json({ error: "Unable to log out" }, { status: 500 });
    }
    return NextResponse.json({ message: "Logged out" });
  }

  const refreshToken = getRefreshToken(request);
  try {
    if (refreshToken) {
      await pool.query(
        `UPDATE auth_sessions
         SET revoked_at = COALESCE(revoked_at, CURRENT_TIMESTAMP),
             updated_at = CURRENT_TIMESTAMP
         WHERE refresh_token_hash = $1`,
        [hashToken(refreshToken)],
      );
    }
    const response = NextResponse.json({ message: "Logged out" });
    clearAuthCookies(response);
    return response;
  } catch (error) {
    console.error("Failed to log out", error);
    return NextResponse.json({ error: "Unable to log out" }, { status: 500 });
  }
}
