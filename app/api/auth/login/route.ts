import { NextRequest, NextResponse } from "next/server";
import pool, { adminPool } from "@/lib/db";
import {
  AUTH_USER_COLUMNS,
  createAuthenticatedSession,
  setAuthCookies,
  verifyPassword,
} from "@/lib/auth";
import { validateLoginPayload } from "@/lib/authValidation";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseAuthConfigured } from "@/lib/supabase/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { linkExistingCrmIdentity } from "@/lib/supabase/workspaceProvisioning";

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
  if (isSupabaseAuthConfigured()) {
    try {
      const legacyResult = await adminPool.query(
        `SELECT ${AUTH_USER_COLUMNS}, u.auth_user_id, u.password_hash
         FROM users u
         WHERE (LOWER(u.email) = LOWER($1) OR LOWER(u.username) = LOWER($1))
           AND u.deleted_at IS NULL
         LIMIT 1`,
        [identifier],
      );
      const legacyUser = legacyResult.rows[0];
      const email = typeof legacyUser?.email === "string" ? legacyUser.email : identifier;
      const supabase = await createSupabaseServerClient();
      let authResult = await supabase.auth.signInWithPassword({ email, password });

      if (
        authResult.error &&
        legacyUser &&
        !legacyUser.auth_user_id &&
        legacyUser.is_active &&
        (await verifyPassword(password, legacyUser.password_hash ?? null))
      ) {
        const admin = createSupabaseAdminClient();
        const created = await admin.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
          user_metadata: {
            first_name: legacyUser.first_name,
            last_name: legacyUser.last_name,
          },
        });

        let authUserId = created.data.user?.id;
        if (created.error && !authUserId) {
          const existingAuthUser = await adminPool.query(
            `SELECT id FROM auth.users WHERE LOWER(email) = LOWER($1) LIMIT 1`,
            [email],
          );
          authUserId = existingAuthUser.rows[0]?.id;
        }
        if (!authUserId) {
          throw created.error ?? new Error("Unable to migrate legacy identity");
        }

        await linkExistingCrmIdentity(authUserId, email);
        authResult = await supabase.auth.signInWithPassword({ email, password });
      }

      if (authResult.error || !authResult.data.user) {
        return NextResponse.json(
          { error: "Invalid username/email or password" },
          { status: 401 },
        );
      }

      const user = await linkExistingCrmIdentity(
        authResult.data.user.id,
        authResult.data.user.email ?? email,
      );
      if (!user) {
        await supabase.auth.signOut();
        return NextResponse.json(
          { error: "This account is not connected to a CRM workspace" },
          { status: 403 },
        );
      }
      await adminPool.query(
        "UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE user_id = $1",
        [user.user_id],
      );
      return NextResponse.json({ message: "Login successful", user });
    } catch (error) {
      console.error("Failed to log in with Supabase", error);
      return NextResponse.json({ error: "Unable to log in" }, { status: 500 });
    }
  }

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

    const client = await pool.connect();
    let tokens: { accessToken: string; refreshToken: string };
    try {
      await client.query("BEGIN");
      tokens = await createAuthenticatedSession(client, request, user.user_id);
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
    setAuthCookies(response, tokens.accessToken, tokens.refreshToken);
    return response;
  } catch (error) {
    console.error("Failed to log in", error);
    return NextResponse.json({ error: "Unable to log in" }, { status: 500 });
  }
}
