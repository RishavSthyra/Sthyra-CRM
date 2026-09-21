import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { parseUserId } from "@/lib/users";
import { validateSingleUuidField } from "@/lib/userRelations";

type UserContext = {
  params: Promise<{ userid: string }>;
};

const ROLE_COLUMNS = `
  r.role_id,
  r.role_key,
  r.role_name,
  r.description,
  r.is_active,
  r.is_system_role,
  r.created_at,
  r.updated_at
`;

export async function GET(_request: NextRequest, context: UserContext) {
  const { userid } = await context.params;
  const userId = parseUserId(userid);
  if (userId === null) {
    return NextResponse.json({ error: "userid must be a valid UUID" }, { status: 400 });
  }

  try {
    const result = await pool.query(
      `SELECT ${ROLE_COLUMNS}
       FROM users u
       JOIN roles r ON r.role_id = u.role_id
       WHERE u.user_id = $1 AND u.deleted_at IS NULL`,
      [userId],
    );
    if (result.rowCount === 0) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }
    return NextResponse.json({ roles: result.rows });
  } catch (error) {
    console.error("Failed to retrieve user role", error);
    return NextResponse.json({ error: "Unable to retrieve user role" }, { status: 500 });
  }
}

export async function PUT(request: NextRequest, context: UserContext) {
  const { userid } = await context.params;
  const userId = parseUserId(userid);
  if (userId === null) {
    return NextResponse.json({ error: "userid must be a valid UUID" }, { status: 400 });
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

  const validation = validateSingleUuidField(body, "role_id", { nullable: false });
  if (!validation.ok) {
    return NextResponse.json(
      { error: "Validation failed", details: validation.errors },
      { status: 422 },
    );
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const userResult = await client.query(
      "SELECT user_id FROM users WHERE user_id = $1 AND deleted_at IS NULL FOR UPDATE",
      [userId],
    );
    if (userResult.rowCount === 0) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const roleResult = await client.query(
      `SELECT ${ROLE_COLUMNS} FROM roles r WHERE r.role_id = $1`,
      [validation.value],
    );
    if (roleResult.rowCount === 0) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "Role not found" }, { status: 404 });
    }

    await client.query(
      "UPDATE users SET role_id = $1, updated_at = CURRENT_TIMESTAMP WHERE user_id = $2",
      [validation.value, userId],
    );
    await client.query("COMMIT");
    return NextResponse.json({ message: "User role replaced", roles: roleResult.rows });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    console.error("Failed to replace user role", error);
    return NextResponse.json({ error: "Unable to replace user role" }, { status: 500 });
  } finally {
    client.release();
  }
}
