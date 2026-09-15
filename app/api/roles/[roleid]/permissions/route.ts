import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { isUuid } from "@/lib/permissions";
import { getRoleDatabaseErrorCode, parseRoleId } from "@/lib/roles";

type RolePermissionsContext = {
  params: Promise<{ roleid: string }>;
};

const PERMISSION_COLUMNS = `
  p.permission_id,
  p.permission_key,
  p.permission_name,
  p.feature_key,
  p.action,
  p.description,
  p.created_at,
  p.updated_at
`;

function validatePermissionIds(body: unknown):
  | { ok: true; permissionIds: string[] }
  | { ok: false; errors: string[] } {
  if (
    typeof body !== "object" ||
    body === null ||
    Array.isArray(body)
  ) {
    return { ok: false, errors: ["Request body must be a JSON object"] };
  }

  const fields = Object.keys(body);
  const errors = fields
    .filter((field) => field !== "permission_ids")
    .map((field) => `Unknown field: ${field}`);

  const permissionIds = (body as { permission_ids?: unknown }).permission_ids;
  
  if (!Array.isArray(permissionIds)) {
    errors.push("permission_ids must be an array");
    return { ok: false, errors };
  }

  const normalizedIds: string[] = [];
  const seen = new Set<string>();
  permissionIds.forEach((permissionId, index) => {
    if (!isUuid(permissionId)) {
      errors.push(`permission_ids[${index}] must be a valid UUID`);
      return;
    }

    const normalized = permissionId.toLowerCase();
    if (seen.has(normalized)) {
      errors.push(`permission_ids contains a duplicate UUID: ${permissionId}`);
      return;
    }
    seen.add(normalized);
    normalizedIds.push(normalized);
  });

  return errors.length > 0
    ? { ok: false, errors }
    : { ok: true, permissionIds: normalizedIds };
}

async function roleExists(
  queryable: { query: (text: string, values?: unknown[]) => Promise<{ rowCount: number | null }> },
  roleId: string,
): Promise<boolean> {
  const result = await queryable.query(
    "SELECT role_id FROM roles WHERE role_id = $1",
    [roleId],
  );
  return (result.rowCount ?? 0) > 0;
}

export async function GET(
  _request: NextRequest,
  context: RolePermissionsContext,
) {
  const { roleid } = await context.params;
  const roleId = parseRoleId(roleid);
  if (roleId === null) {
    return NextResponse.json(
      { error: "roleid must be a valid UUID" },
      { status: 400 },
    );
  }

  try {
    if (!(await roleExists(pool, roleId))) {
      return NextResponse.json({ error: "Role not found" }, { status: 404 });
    }

    const result = await pool.query(
      `SELECT ${PERMISSION_COLUMNS}
       FROM role_permissions rp
       JOIN permissions p ON p.permission_id = rp.permission_id
       WHERE rp.role_id = $1
       ORDER BY p.feature_key ASC, p.action ASC, p.permission_key ASC, p.permission_id ASC`,
      [roleId],
    );

    return NextResponse.json({ permissions: result.rows });
  } catch (error) {
    console.error("Failed to retrieve role permissions", error);
    return NextResponse.json(
      { error: "Unable to retrieve role permissions" },
      { status: 500 },
    );
  }
}

export async function PUT(
  request: NextRequest,
  context: RolePermissionsContext,
) {
  const { roleid } = await context.params;
  const roleId = parseRoleId(roleid);
  if (roleId === null) {
    return NextResponse.json(
      { error: "roleid must be a valid UUID" },
      { status: 400 },
    );
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

  const validation = validatePermissionIds(body);
  if (!validation.ok) {
    return NextResponse.json(
      { error: "Validation failed", details: validation.errors },
      { status: 422 },
    );
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const roleResult = await client.query(
      "SELECT role_id FROM roles WHERE role_id = $1 FOR UPDATE",
      [roleId],
    );
    if (roleResult.rowCount === 0) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "Role not found" }, { status: 404 });
    }

    if (validation.permissionIds.length > 0) {
      const permissionResult = await client.query(
        "SELECT permission_id::text AS permission_id FROM permissions WHERE permission_id = ANY($1::uuid[])",
        [validation.permissionIds],
      );
      const existingIds = new Set(
        permissionResult.rows.map((row: { permission_id: string }) =>
          row.permission_id.toLowerCase(),
        ),
      );
      const missingIds = validation.permissionIds.filter(
        (permissionId) => !existingIds.has(permissionId),
      );

      if (missingIds.length > 0) {
        await client.query("ROLLBACK");
        return NextResponse.json(
          {
            error: "One or more permissions were not found",
            details: { permission_ids: missingIds },
          },
          { status: 422 },
        );
      }
    }

    await client.query("DELETE FROM role_permissions WHERE role_id = $1", [roleId]);

    if (validation.permissionIds.length > 0) {
      await client.query(
        `INSERT INTO role_permissions (role_id, permission_id)
         SELECT $1::uuid, ids.permission_id
         FROM unnest($2::uuid[]) AS ids(permission_id)`,
        [roleId, validation.permissionIds],
      );
    }

    const result = await client.query(
      `SELECT ${PERMISSION_COLUMNS}
       FROM role_permissions rp
       JOIN permissions p ON p.permission_id = rp.permission_id
       WHERE rp.role_id = $1
       ORDER BY p.feature_key ASC, p.action ASC, p.permission_key ASC, p.permission_id ASC`,
      [roleId],
    );

    await client.query("COMMIT");
    return NextResponse.json({
      message: "Role permissions replaced",
      permissions: result.rows,
    });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    const code = getRoleDatabaseErrorCode(error);
    if (code === "23503") {
      return NextResponse.json(
        { error: "Role permission references an unknown record" },
        { status: 422 },
      );
    }
    if (code === "23505") {
      return NextResponse.json(
        { error: "A role permission assignment already exists" },
        { status: 409 },
      );
    }

    console.error("Failed to replace role permissions", error);
    return NextResponse.json(
      { error: "Unable to replace role permissions" },
      { status: 500 },
    );
  } finally {
    client.release();
  }
}
