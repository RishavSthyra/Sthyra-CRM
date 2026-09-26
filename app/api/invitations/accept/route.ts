import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import {
  AUTH_USER_COLUMNS,
  createAuthenticatedSession,
  hashPassword,
  hashToken,
  setAuthCookies,
} from "@/lib/auth";
import { getDatabaseErrorCode } from "@/utils/getDatabaseErrorCode";
import { isObject } from "@/utils/isObject";
import { validatePassword } from "@/utils/validatePassword";
import { validateText } from "@/utils/validateText";

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
  if (!isObject(body) || Array.isArray(body)) {
    return NextResponse.json(
      { error: "Request body must be an object" },
      { status: 400 },
    );
  }
  const errors: string[] = [];
  const token = validateText(body.token, "token", 200, false, errors);
  const firstName = validateText(
    body.first_name,
    "first_name",
    200,
    false,
    errors,
  );
  const lastName = validateText(body.last_name, "last_name", 200, true, errors);
  const username = validateText(body.username, "username", 200, false, errors);
  const phone = validateText(body.phone, "phone", 20, true, errors);
  errors.push(...validatePassword(body.password));
  if (
    typeof username === "string" &&
    !/^[a-zA-Z0-9._-]{3,200}$/.test(username)
  ) {
    errors.push(
      "username must contain 3 to 200 letters, numbers, dots, underscores, or hyphens",
    );
  }
  if (typeof phone === "string" && !/^\+?[0-9]{10,19}$/.test(phone)) {
    errors.push("phone must contain 10 to 19 digits");
  }
  if (
    errors.length ||
    typeof token !== "string" ||
    typeof firstName !== "string" ||
    typeof username !== "string" ||
    typeof body.password !== "string"
  ) {
    return NextResponse.json(
      { error: "Validation failed", details: errors },
      { status: 422 },
    );
  }

  const tokenHash = hashToken(token);
  try {
    const preflight = await pool.query(
      `SELECT status, expires_at FROM workspace_invitations WHERE token_hash=$1`,
      [tokenHash],
    );
    if (!preflight.rowCount) {
      return NextResponse.json(
        { error: "This invitation link is invalid" },
        { status: 404 },
      );
    }
    if (preflight.rows[0].status !== "pending") {
      return NextResponse.json(
        { error: `This invitation has already been ${preflight.rows[0].status}` },
        { status: 410 },
      );
    }
    if (new Date(preflight.rows[0].expires_at) <= new Date()) {
      await pool.query(
        `UPDATE workspace_invitations SET status='expired', updated_at=CURRENT_TIMESTAMP
         WHERE token_hash=$1 AND status='pending'`,
        [tokenHash],
      );
      return NextResponse.json(
        { error: "This invitation has expired" },
        { status: 410 },
      );
    }
  } catch (error) {
    console.error("Failed to preflight invitation acceptance", error);
    return NextResponse.json(
      { error: "Unable to validate invitation" },
      { status: 500 },
    );
  }
  const passwordHash = await hashPassword(body.password);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const invitationResult = await client.query(
      `SELECT wi.*, c.company_name
       FROM workspace_invitations wi
       JOIN companies c ON c.company_id=wi.company_id
       WHERE wi.token_hash=$1
       FOR UPDATE OF wi`,
      [tokenHash],
    );
    if (!invitationResult.rowCount) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: "This invitation link is invalid" },
        { status: 404 },
      );
    }
    const invitation = invitationResult.rows[0];
    if (invitation.status !== "pending") {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: `This invitation has already been ${invitation.status}` },
        { status: 410 },
      );
    }
    if (new Date(invitation.expires_at) <= new Date()) {
      await client.query(
        `UPDATE workspace_invitations SET status='expired', updated_at=CURRENT_TIMESTAMP WHERE invitation_id=$1`,
        [invitation.invitation_id],
      );
      await client.query("COMMIT");
      return NextResponse.json(
        { error: "This invitation has expired" },
        { status: 410 },
      );
    }
    const userResult = await client.query(
      `INSERT INTO users (
         team_id, role_id, username, first_name, last_name, email, phone,
         password_hash, is_active, password_changed_at, created_by
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,TRUE,CURRENT_TIMESTAMP,$9)
       RETURNING user_id`,
      [
        invitation.team_id,
        invitation.role_id,
        username.toLowerCase(),
        firstName,
        lastName ?? null,
        invitation.email,
        phone ?? null,
        passwordHash,
        invitation.invited_by,
      ],
    );
    const userId = String(userResult.rows[0].user_id);
    await client.query(
      `UPDATE workspace_invitations
       SET status='accepted', accepted_at=CURRENT_TIMESTAMP, accepted_by=$2,
           updated_at=CURRENT_TIMESTAMP
       WHERE invitation_id=$1`,
      [invitation.invitation_id, userId],
    );
    const tokens = await createAuthenticatedSession(client, request, userId);
    const user = await client.query(
      `SELECT ${AUTH_USER_COLUMNS} FROM users u WHERE u.user_id=$1`,
      [userId],
    );
    await client.query("COMMIT");
    const response = NextResponse.json(
      {
        message: "Invitation accepted",
        user: user.rows[0],
        company: {
          company_id: invitation.company_id,
          company_name: invitation.company_name,
        },
      },
      { status: 201 },
    );
    response.headers.set("Cache-Control", "no-store");
    setAuthCookies(response, tokens.accessToken, tokens.refreshToken);
    return response;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    if (getDatabaseErrorCode(error) === "23505") {
      return NextResponse.json(
        { error: "That username or email is already in use" },
        { status: 409 },
      );
    }
    console.error("Failed to accept invitation", error);
    return NextResponse.json(
      { error: "Unable to accept invitation" },
      { status: 500 },
    );
  } finally {
    client.release();
  }
}
