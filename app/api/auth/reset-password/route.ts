import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { hashPassword, hashToken } from "@/lib/auth";
import { validateResetPasswordPayload } from "@/lib/authValidation";

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
  const validation = validateResetPasswordPayload(body);
  if (!validation.ok) {
    return NextResponse.json(
      { error: "Validation failed", details: validation.errors },
      { status: 422 },
    );
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const tokenResult = await client.query(
      `SELECT reset_id, user_id
       FROM password_reset_tokens
       WHERE token_hash = $1
         AND used_at IS NULL
         AND expires_at > CURRENT_TIMESTAMP
       FOR UPDATE`,
      [hashToken(validation.data.token)],
    );
    if (tokenResult.rowCount === 0) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: "Reset token is invalid or expired" },
        { status: 400 },
      );
    }

    const reset = tokenResult.rows[0];
    const passwordHash = await hashPassword(validation.data.newPassword);
    await client.query(
      `UPDATE users
       SET password_hash = $1,
           password_changed_at = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP
       WHERE user_id = $2 AND deleted_at IS NULL`,
      [passwordHash, reset.user_id],
    );
    await client.query(
      "UPDATE password_reset_tokens SET used_at = CURRENT_TIMESTAMP WHERE reset_id = $1",
      [reset.reset_id],
    );
    await client.query(
      `UPDATE auth_sessions
       SET revoked_at = COALESCE(revoked_at, CURRENT_TIMESTAMP),
           updated_at = CURRENT_TIMESTAMP
       WHERE user_id = $1`,
      [reset.user_id],
    );
    await client.query("COMMIT");
    return NextResponse.json({ message: "Password reset successfully" });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    console.error("Failed to reset password", error);
    return NextResponse.json(
      { error: "Unable to reset password" },
      { status: 500 },
    );
  } finally {
    client.release();
  }
}
