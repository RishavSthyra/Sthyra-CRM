import { randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import pool, { adminPool } from "@/lib/db";
import {
  AUTH_USER_COLUMNS,
  createAuthenticatedSession,
  hashPassword,
  setAuthCookies,
} from "@/lib/auth";
import { validateSignupPayload } from "@/lib/authValidation";
import {
  AuthEmailConfigurationError,
  sendSignupVerificationCode,
} from "@/lib/authVerificationEmail";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseAuthConfigured } from "@/lib/supabase/config";
import { provisionWorkspaceForAuthUser } from "@/lib/supabase/workspaceProvisioning";
import { getDatabaseErrorCode } from "@/utils/getDatabaseErrorCode";
import { enforceRateLimits } from "@/lib/rateLimit";
import {
  createAvailableWorkspaceIdentity,
  provisionTenantDomain,
} from "@/lib/tenantDomains";

function createUsername(email: string): string {
  const localPart = email.split("@")[0].replace(/[^a-zA-Z0-9._-]/g, "");
  const base = localPart.slice(0, 180) || "user";
  return `${base}-${randomBytes(4).toString("hex")}`.toLowerCase();
}

export async function POST(request: NextRequest) {
  const ipLimit = await enforceRateLimits(request, [
    { action: "signup:ip", limit: 5, windowSeconds: 60 * 60 },
  ]);
  if (ipLimit) return ipLimit;

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
  const accountLimit = await enforceRateLimits(request, [
    {
      action: "signup:email",
      subject: `email:${signup.email}`,
      limit: 3,
      windowSeconds: 24 * 60 * 60,
    },
  ]);
  if (accountLimit) return accountLimit;
  if (isSupabaseAuthConfigured()) {
    try {
      const existing = await adminPool.query(
        `SELECT 1 FROM users
         WHERE LOWER(email) = LOWER($1) AND deleted_at IS NULL
         LIMIT 1`,
        [signup.email],
      );
      if (existing.rowCount) {
        return NextResponse.json(
          { error: "An account already uses this email address" },
          { status: 409 },
        );
      }

      const admin = createSupabaseAdminClient();
      const { data, error } = await admin.auth.admin.generateLink({
        type: "signup",
        email: signup.email,
        password: signup.password,
        options: {
          data: {
            first_name: signup.first_name,
            last_name: signup.last_name,
          },
        },
      });
      if (error || !data.user || !data.properties?.email_otp) {
        return NextResponse.json(
          { error: "Unable to create this authentication account" },
          { status: error?.status === 422 ? 422 : 409 },
        );
      }

      try {
        await sendSignupVerificationCode({
          email: signup.email,
          code: data.properties.email_otp,
        });
        const workspace = await provisionWorkspaceForAuthUser(
          data.user.id,
          signup,
        );
        return NextResponse.json(
          {
            message: "Account created. Enter the code sent to your email.",
            requires_email_confirmation: true,
            otp_length: data.properties.email_otp.length,
            ...workspace,
          },
          { status: 201 },
        );
      } catch (error) {
        await admin.auth.admin.deleteUser(data.user.id);
        throw error;
      }
    } catch (error) {
      if (
        getDatabaseErrorCode(error) === "23505" ||
        (error instanceof Error &&
          error.message === "CRM_IDENTITY_ALREADY_EXISTS")
      ) {
        return NextResponse.json(
          {
            error:
              "An account, company email, or company code already uses these details",
          },
          { status: 409 },
        );
      }
      console.error("Failed to sign up with Supabase", error);
      if (error instanceof AuthEmailConfigurationError) {
        return NextResponse.json(
          { error: "Signup email is not configured on the server" },
          { status: 503 },
        );
      }
      return NextResponse.json(
        {
          error:
            error instanceof Error && /email|smtp/i.test(error.message)
              ? "Unable to send the verification code"
              : "Unable to create account",
        },
        { status: 500 },
      );
    }
  }

  const passwordHash = await hashPassword(signup.password);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO roles (
         role_key, role_name, description, is_system_role
       ) VALUES (
         'SUPER_ADMIN', 'Super Admin',
         'Highest-authority workspace administrator with unrestricted access', TRUE
       ) ON CONFLICT DO NOTHING`,
    );
    const roleResult = await client.query(
      `SELECT role_id FROM roles
       WHERE role_key='SUPER_ADMIN' AND is_active=TRUE`,
    );
    if (!roleResult.rowCount) {
      throw new Error("SUPER_ADMIN role is unavailable");
    }

    const workspace = await createAvailableWorkspaceIdentity(
      client,
      signup.company_code || signup.company_name,
    );
    const companyResult = await client.query(
      `INSERT INTO companies (
         company_name, company_legal_name, established_on,
         company_phone_number, company_contact_email, company_code,
         workspace_slug, workspace_domain, workspace_domain_status
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'pending')
       RETURNING company_id, company_name, company_code,
                 workspace_slug, workspace_domain, workspace_domain_status`,
      [
        signup.company_name,
        signup.company_legal_name,
        signup.established_on,
        signup.company_phone_number,
        signup.company_contact_email,
        signup.company_code,
        workspace.slug,
        workspace.domain,
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

    const domain = await provisionTenantDomain(
      Number(company.company_id),
      String(company.workspace_domain),
    );

    const response = NextResponse.json(
      {
        message: "Account created successfully",
        user: user.rows[0],
        company: { ...company, workspace_domain_status: domain.status },
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
