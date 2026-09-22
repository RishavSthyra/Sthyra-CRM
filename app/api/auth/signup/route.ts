import { randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import {
  AUTH_USER_COLUMNS,
  createAuthenticatedSession,
  hashPassword,
  setAuthCookies,
} from "@/lib/auth";
import { validateSignupPayload } from "@/lib/authValidation";
import { getDatabaseErrorCode } from "@/utils/getDatabaseErrorCode";

export const runtime = "nodejs";

function createUsername(email: string): string {
  const localPart = email.split("@")[0].replace(/[^a-zA-Z0-9._-]/g, "");
  const base = localPart.slice(0, 180) || "user";
  return `${base}-${randomBytes(4).toString("hex")}`.toLowerCase();
}

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

  const validation = validateSignupPayload(body);
  if (!validation.ok) {
    return NextResponse.json(
      { error: "Validation failed", details: validation.errors },
      { status: 422 },
    );
  }

  const signup = validation.data;
  const passwordHash = await hashPassword(signup.password);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO roles (
         role_key, role_name, description, is_system_role
       ) VALUES (
         'COMPANY_OWNER', 'Company Owner',
         'Initial owner of a company workspace', TRUE
       ) ON CONFLICT (role_key) DO NOTHING`,
    );
    const roleResult = await client.query(
      `SELECT role_id FROM roles
       WHERE role_key='COMPANY_OWNER' AND is_active=TRUE`,
    );
    if (!roleResult.rowCount) {
      throw new Error("COMPANY_OWNER role is unavailable");
    }

    const companyResult = await client.query(
      `INSERT INTO companies (
         company_name, company_legal_name, established_on,
         company_phone_number, company_contact_email, company_code
       ) VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING company_id, company_name, company_code`,
      [
        signup.company_name,
        signup.company_legal_name,
        signup.established_on,
        signup.company_phone_number,
        signup.company_contact_email,
        signup.company_code,
      ],
    );
    const company = companyResult.rows[0];
    const teamResult = await client.query(
      `INSERT INTO teams (company_id, name, team_type, description)
       VALUES ($1, 'Leadership', $2, 'Initial company leadership team')
       RETURNING team_id`,
      [company.company_id, signup.job_role],
    );
    const userResult = await client.query(
      `INSERT INTO users (
         team_id, role_id, username, first_name, last_name,
         email, password_hash, is_active, password_changed_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,TRUE,CURRENT_TIMESTAMP)
       RETURNING user_id`,
      [
        teamResult.rows[0].team_id,
        roleResult.rows[0].role_id,
        createUsername(signup.email),
        signup.first_name,
        signup.last_name,
        signup.email,
        passwordHash,
      ],
    );
    const userId = userResult.rows[0].user_id as string;
    const tokens = await createAuthenticatedSession(client, request, userId);
    const user = await client.query(
      `SELECT ${AUTH_USER_COLUMNS} FROM users u WHERE u.user_id=$1`,
      [userId],
    );
    await client.query("COMMIT");

    const response = NextResponse.json(
      {
        message: "Account created successfully",
        user: user.rows[0],
        company,
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
        {
          error:
            "An account, company email, or company code already uses these details",
        },
        { status: 409 },
      );
    }
    console.error("Failed to sign up", error);
    return NextResponse.json(
      { error: "Unable to create account" },
      { status: 500 },
    );
  } finally {
    client.release();
  }
}
