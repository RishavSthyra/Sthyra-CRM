import { randomBytes } from "node:crypto";
import { AUTH_USER_COLUMNS } from "@/lib/auth";
import type { SignupPayload } from "@/lib/authValidation";
import { adminPool } from "@/lib/db";

function createUsername(email: string): string {
  const localPart = email.split("@")[0].replace(/[^a-zA-Z0-9._-]/g, "");
  const base = localPart.slice(0, 180) || "user";
  return `${base}-${randomBytes(4).toString("hex")}`.toLowerCase();
}

export async function provisionWorkspaceForAuthUser(
  authUserId: string,
  signup: SignupPayload,
) {
  const client = await adminPool.connect();
  try {
    await client.query("BEGIN");
    const duplicate = await client.query(
      `SELECT user_id
       FROM users
       WHERE auth_user_id = $1 OR LOWER(email) = LOWER($2)
       LIMIT 1
       FOR UPDATE`,
      [authUserId, signup.email],
    );
    if (duplicate.rowCount) {
      throw new Error("CRM_IDENTITY_ALREADY_EXISTS");
    }

    await client.query(
      `INSERT INTO roles (
         role_key, role_name, description, is_system_role
       ) VALUES (
         'COMPANY_OWNER', 'Company Owner',
         'Initial owner of a company workspace', TRUE
       ) ON CONFLICT DO NOTHING`,
    );
    const roleResult = await client.query(
      `SELECT role_id FROM roles
       WHERE role_key = 'COMPANY_OWNER' AND is_active = TRUE`,
    );
    if (!roleResult.rowCount) {
      throw new Error("COMPANY_OWNER role is unavailable");
    }

    const companyResult = await client.query(
      `INSERT INTO companies (
         company_name, company_legal_name, established_on,
         company_phone_number, company_contact_email, company_code
       ) VALUES ($1, $2, $3, $4, $5, $6)
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
         auth_user_id, team_id, role_id, username, first_name, last_name,
         email, password_hash, is_active, password_changed_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, NULL, TRUE, CURRENT_TIMESTAMP)
       RETURNING user_id`,
      [
        authUserId,
        teamResult.rows[0].team_id,
        roleResult.rows[0].role_id,
        createUsername(signup.email),
        signup.first_name,
        signup.last_name,
        signup.email,
      ],
    );
    const userId = String(userResult.rows[0].user_id);
    await client.query(
      `INSERT INTO workspace_memberships (
         auth_user_id, crm_user_id, company_id, is_active, is_default
       ) VALUES ($1, $2, $3, TRUE, TRUE)
       ON CONFLICT (crm_user_id) DO UPDATE
       SET auth_user_id = EXCLUDED.auth_user_id,
           company_id = EXCLUDED.company_id,
           is_active = TRUE,
           is_default = TRUE,
           updated_at = CURRENT_TIMESTAMP`,
      [authUserId, userId, company.company_id],
    );
    const user = await client.query(
      `SELECT ${AUTH_USER_COLUMNS} FROM users u WHERE u.user_id = $1`,
      [userId],
    );
    await client.query("COMMIT");
    return { company, user: user.rows[0] };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function linkExistingCrmIdentity(
  authUserId: string,
  email: string,
) {
  const client = await adminPool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `SELECT u.user_id, u.auth_user_id, u.team_id, t.company_id
       FROM users u
       JOIN teams t ON t.team_id = u.team_id
       WHERE (u.auth_user_id = $1 OR LOWER(u.email) = LOWER($2))
         AND u.is_active = TRUE
         AND u.deleted_at IS NULL
       ORDER BY CASE WHEN u.auth_user_id = $1 THEN 0 ELSE 1 END
       LIMIT 1
       FOR UPDATE OF u`,
      [authUserId, email],
    );
    if (!result.rowCount) {
      await client.query("ROLLBACK");
      return null;
    }

    const identity = result.rows[0];
    if (identity.auth_user_id && identity.auth_user_id !== authUserId) {
      throw new Error("CRM identity is linked to a different auth user");
    }
    await client.query(
      `UPDATE users
       SET auth_user_id = $1,
           password_hash = NULL,
           updated_at = CURRENT_TIMESTAMP
       WHERE user_id = $2`,
      [authUserId, identity.user_id],
    );
    await client.query(
      `INSERT INTO workspace_memberships (
         auth_user_id, crm_user_id, company_id, is_active, is_default
       ) VALUES ($1, $2, $3, TRUE, TRUE)
       ON CONFLICT (crm_user_id) DO UPDATE
       SET auth_user_id = EXCLUDED.auth_user_id,
           company_id = EXCLUDED.company_id,
           is_active = TRUE,
           is_default = TRUE,
           updated_at = CURRENT_TIMESTAMP`,
      [authUserId, identity.user_id, identity.company_id],
    );
    const user = await client.query(
      `SELECT ${AUTH_USER_COLUMNS} FROM users u WHERE u.user_id = $1`,
      [identity.user_id],
    );
    await client.query("COMMIT");
    return user.rows[0] ?? null;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
