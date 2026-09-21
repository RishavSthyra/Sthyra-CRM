import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { parseUserId } from "@/lib/users";

type UserContext = {
  params: Promise<{ userid: string }>;
};

export async function GET(_request: NextRequest, context: UserContext) {
  const { userid } = await context.params;
  const userId = parseUserId(userid);
  if (userId === null) {
    return NextResponse.json({ error: "userid must be a valid UUID" }, { status: 400 });
  }

  try {
    const userResult = await pool.query(
      "SELECT user_id FROM users WHERE user_id = $1 AND deleted_at IS NULL",
      [userId],
    );
    if (userResult.rowCount === 0) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const result = await pool.query(
      `SELECT
         p.permission_id,
         p.permission_key,
         p.permission_name,
         p.feature_key,
         p.action,
         p.description,
         p.created_at,
         p.updated_at
       FROM users u
       JOIN roles r ON r.role_id = u.role_id
       JOIN role_permissions rp ON rp.role_id = r.role_id
       JOIN permissions p ON p.permission_id = rp.permission_id
       WHERE u.user_id = $1
         AND u.deleted_at IS NULL
         AND u.is_active = TRUE
         AND r.is_active = TRUE
       ORDER BY p.feature_key ASC, p.action ASC, p.permission_key ASC`,
      [userId],
    );
    return NextResponse.json({ permissions: result.rows });
  } catch (error) {
    console.error("Failed to retrieve effective permissions", error);
    return NextResponse.json(
      { error: "Unable to retrieve effective permissions" },
      { status: 500 },
    );
  }
}
