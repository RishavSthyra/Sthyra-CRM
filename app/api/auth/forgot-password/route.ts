import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { createOpaqueToken, getRequestIp, hashToken } from "@/lib/auth";
import { validateForgotPasswordPayload } from "@/lib/authValidation";

const GENERIC_MESSAGE =
  "If an active account exists for that email, password reset instructions have been created.";

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
  const validation = validateForgotPasswordPayload(body);
  if (!validation.ok) {
    return NextResponse.json(
      { error: "Validation failed", details: validation.errors },
      { status: 422 },
    );
  }

  try {
    const userResult = await pool.query(
      `SELECT user_id
       FROM users
       WHERE LOWER(email) = LOWER($1)
         AND is_active = TRUE
         AND deleted_at IS NULL
       LIMIT 1`,
      [validation.data.email],
    );
    const userId = userResult.rows[0]?.user_id as string | undefined;
    let developmentResetToken: string | undefined;
    if (userId) {
      const token = createOpaqueToken();
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(
          `UPDATE password_reset_tokens
           SET used_at = CURRENT_TIMESTAMP
           WHERE user_id = $1 AND used_at IS NULL`,
          [userId],
        );
        await client.query(
          `INSERT INTO password_reset_tokens (
             user_id,
             token_hash,
             expires_at,
             requested_ip
           )
           VALUES ($1, $2, CURRENT_TIMESTAMP + INTERVAL '15 minutes', $3)`,
          [userId, hashToken(token), getRequestIp(request)],
        );
        await client.query("COMMIT");
        if (
          process.env.NODE_ENV !== "production" &&
          process.env.AUTH_EXPOSE_RESET_TOKEN === "true"
        ) {
          developmentResetToken = token;
        }
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }

      // Deliver `token` through your email provider here. Never log or persist it raw.
    }

    const response = NextResponse.json({
      message: GENERIC_MESSAGE,
      ...(developmentResetToken
        ? { development_reset_token: developmentResetToken }
        : {}),
    });
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error) {
    console.error("Failed to create password reset", error);
    return NextResponse.json(
      { error: "Unable to process password reset request" },
      { status: 500 },
    );
  }
}
