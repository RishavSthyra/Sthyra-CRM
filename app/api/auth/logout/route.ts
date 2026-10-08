import { after, NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { clearAuthCookies, getRefreshToken, hashToken } from "@/lib/auth";
import { isSupabaseAuthConfigured } from "@/lib/supabase/config";
import { getSupabaseAuthCookieNames } from "@/lib/supabase/logout";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  if (isSupabaseAuthConfigured()) {
    const response = NextResponse.json({ message: "Logged out" });
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    for (const name of getSupabaseAuthCookieNames(
      request.cookies.getAll(),
      supabaseUrl,
    )) {
      response.cookies.set(name, "", {
        expires: new Date(0),
        maxAge: 0,
        path: "/",
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
      });
    }
    clearAuthCookies(response);
    after(async () => {
      try {
        const supabase = await createSupabaseServerClient();
        const { error } = await supabase.auth.signOut({ scope: "local" });
        if (error) console.error("Failed to revoke logged-out session", error);
      } catch (error) {
        console.error("Failed to revoke logged-out session", error);
      }
    });
    return response;
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
