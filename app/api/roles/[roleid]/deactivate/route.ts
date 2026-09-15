import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { ROLE_COLUMNS, parseRoleId, serializeRole } from "@/lib/roles";

type RoleContext = {
  params: Promise<{ roleid: string }>;
};

export async function POST(_request: NextRequest, context: RoleContext) {
  const { roleid } = await context.params;
  const roleId = parseRoleId(roleid);
  if (roleId === null) {
    return NextResponse.json({ error: "roleid must be a valid UUID" }, { status: 400 });
  }

  try {
    const result = await pool.query(
      `UPDATE roles
       SET is_active = FALSE, updated_at = CURRENT_TIMESTAMP
       WHERE role_id = $1
       RETURNING ${ROLE_COLUMNS}`,
      [roleId],
    );
    if (result.rowCount === 0) {
      return NextResponse.json({ error: "Role not found" }, { status: 404 });
    }
    return NextResponse.json({
      message: "Role deactivated",
      role: serializeRole(result.rows[0]),
    });
  } catch (error) {
    console.error("Failed to deactivate role", error);
    return NextResponse.json({ error: "Unable to deactivate role" }, { status: 500 });
  }
}
