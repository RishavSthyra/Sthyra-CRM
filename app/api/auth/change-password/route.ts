import { NextRequest, NextResponse } from "next/server";
import pool, { adminPool } from "@/lib/db";
import {
  authenticateRequest,
  clearAuthCookies,
  hashPassword,
  verifyPassword,
} from "@/lib/auth";
import { validateChangePasswordPayload } from "@/lib/authValidation";
import { isSupabaseAuthConfigured } from "@/lib/supabase/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  const authentication = await authenticateRequest(request);
  if (!authentication.ok) {
    return authentication.response;
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Request body must contain valid JSON" },
      { status: 400 },
    );
  }
  const validation = validateChangePasswordPayload(body);
  if (!validation.ok) {
    return NextResponse.json(
      { error: "Validation failed", details: validation.errors },
      { status: 422 },
    );
  }

  if (isSupabaseAuthConfigured()) {
    const supabase = await createSupabaseServerClient();
    const { data: authUser, error: userError } = await supabase.auth.getUser();
    const email = authUser.user?.email;
    if (userError || !email) {
      return NextResponse.json(
        { error: "Authentication required" },
        { status: 401 },
      );
    }
    const verification = await supabase.auth.signInWithPassword({
      email,
      password: validation.data.currentPassword,
    });
    if (verification.error) {
      return NextResponse.json(
        { error: "Current password is incorrect" },
        { status: 401 },
      );
    }
    const updated = await supabase.auth.updateUser({
      password: validation.data.newPassword,
    });
    if (updated.error) {
      return NextResponse.json(
        { error: "Unable to change password" },
        { status: 400 },
      );
    }
    await adminPool.query(
      `UPDATE users
       SET password_hash = NULL,
           password_changed_at = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP
       WHERE auth_user_id = $1`,
      [authUser.user.id],
    );
    await supabase.auth.signOut({ scope: "global" });
    return NextResponse.json({
      message: "Password changed. Please log in again.",
    });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const userResult = await client.query(
      `SELECT password_hash
       FROM users
       WHERE user_id = $1 AND deleted_at IS NULL
       FOR UPDATE`,
      [authentication.auth.user.user_id],
    );
    const matches = await verifyPassword(
      validation.data.currentPassword,
      userResult.rows[0]?.password_hash ?? null,
    );
    if (!matches) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: "Current password is incorrect" },
        { status: 401 },
      );
    }

    const passwordHash = await hashPassword(validation.data.newPassword);
    await client.query(
      `UPDATE users
       SET password_hash = $1,
           password_changed_at = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP
       WHERE user_id = $2`,
      [passwordHash, authentication.auth.user.user_id],
    );
    await client.query(
      `UPDATE auth_sessions
       SET revoked_at = COALESCE(revoked_at, CURRENT_TIMESTAMP),
           updated_at = CURRENT_TIMESTAMP
       WHERE user_id = $1`,
      [authentication.auth.user.user_id],
    );
    await client.query("COMMIT");

    const response = NextResponse.json({
      message: "Password changed. Please log in again.",
    });
    clearAuthCookies(response);
    return response;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    console.error("Failed to change password", error);
    return NextResponse.json(
      { error: "Unable to change password" },
      { status: 500 },
    );
  } finally {
    client.release();
  }
}
