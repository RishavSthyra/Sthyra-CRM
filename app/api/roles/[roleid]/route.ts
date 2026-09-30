import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import {
  getRoleDatabaseErrorCode,
  ROLE_COLUMNS,
  RoleField,
  parseRoleId,
  serializeRole,
  validateRolePayload,
} from "@/lib/roles";
import { requirePermission } from "@/lib/authorization";

type RoleContext = {
  params: Promise<{ roleid: string }>;
};

export async function GET(request: NextRequest, context: RoleContext) {
  const scope = await requirePermission(request, "PEOPLE_MANAGE");
  if (!scope.ok) return scope.response;

  const { roleid } = await context.params;
  const roleId = parseRoleId(roleid);

  if (roleId === null) {
    return NextResponse.json({ error: "roleid must be a valid UUID" }, { status: 400 });
  }

  try {
    const result = await pool.query(
      `SELECT ${ROLE_COLUMNS} FROM roles WHERE role_id = $1`,
      [roleId],
    );
    if (result.rowCount === 0) {
      return NextResponse.json({ error: "Role not found" }, { status: 404 });
    }
    return NextResponse.json({ role: serializeRole(result.rows[0]) });
  } catch (error) {
    console.error("Failed to retrieve role", error);
    return NextResponse.json({ error: "Unable to retrieve role" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest, context: RoleContext) {
  const scope = await requirePermission(request, "PEOPLE_MANAGE");
  if (!scope.ok) return scope.response;

  const { roleid } = await context.params;
  const roleId = parseRoleId(roleid);

  if (roleId === null) {
    return NextResponse.json({ error: "roleid must be a valid UUID" }, { status: 400 });
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

  const validation = validateRolePayload(body, { partial: true });
  if (!validation.ok) {
    return NextResponse.json(
      { error: "Validation failed", details: validation.errors },
      { status: 422 },
    );
  }

  const mutableFields: RoleField[] = ["role_key", "role_name", "description"];
  const updates = mutableFields
    .filter((field) => validation.data[field] !== undefined)
    .map((field) => ({ field, value: validation.data[field] }));
  const values: unknown[] = updates.map(({ value }) => value);
  const assignments = updates.map(
    ({ field }, index) => `${field} = $${index + 1}`,
  );
  values.push(roleId);

  try {
    const result = await pool.query(
      `UPDATE roles
       SET ${assignments.join(", ")}, updated_at = CURRENT_TIMESTAMP
       WHERE role_id = $${values.length} AND is_system_role = FALSE
       RETURNING ${ROLE_COLUMNS}`,
      values,
    );
    if (result.rowCount === 0) {
      return NextResponse.json(
        { error: "Custom role not found or system role cannot be changed" },
        { status: 404 },
      );
    }
    return NextResponse.json({
      message: "Role updated",
      role: serializeRole(result.rows[0]),
    });
  } catch (error) {
    const code = getRoleDatabaseErrorCode(error);
    if (code === "23505") {
      return NextResponse.json(
        { error: "A role with this role_key already exists" },
        { status: 409 },
      );
    }
    console.error("Failed to update role", error);
    return NextResponse.json({ error: "Unable to update role" }, { status: 500 });
  }
}
