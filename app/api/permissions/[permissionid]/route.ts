import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import {
  getPermissionDatabaseErrorCode,
  PERMISSION_COLUMNS,
  PermissionField,
  parsePermissionId,
  serializePermission,
  validatePermissionPayload,
} from "@/lib/permissions";

const PERMISSION_TABLE = "permissions";

type PermissionContext = {
  params: Promise<{ permissionid: string }>;
};

export async function GET(
  _request: NextRequest,
  context: PermissionContext,
) {
  const { permissionid } = await context.params;
  const permissionId = parsePermissionId(permissionid);

  if (permissionId === null) {
    return NextResponse.json(
      { error: "permissionid must be a valid UUID" },
      { status: 400 },
    );
  }

  try {
    const result = await pool.query(
      `SELECT ${PERMISSION_COLUMNS}
       FROM ${PERMISSION_TABLE}
       WHERE permission_id = $1`,
      [permissionId],
    );

    if (result.rowCount === 0) {
      return NextResponse.json(
        { error: "Permission not found" },
        { status: 404 },
      );
    }

    return NextResponse.json({ permission: serializePermission(result.rows[0]) });
  } catch (error) {
    console.error("Failed to retrieve permission", error);
    return NextResponse.json(
      { error: "Unable to retrieve permission" },
      { status: 500 },
    );
  }
}

export async function PATCH(
  request: NextRequest,
  context: PermissionContext,
) {
  const { permissionid } = await context.params;
  const permissionId = parsePermissionId(permissionid);

  if (permissionId === null) {
    return NextResponse.json(
      { error: "permissionid must be a valid UUID" },
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

  const validation = validatePermissionPayload(body, { partial: true });
  if (!validation.ok) {
    return NextResponse.json(
      { error: "Validation failed", details: validation.errors },
      { status: 422 },
    );
  }

  const mutableFields: PermissionField[] = [
    "permission_key",
    "permission_name",
    "feature_key",
    "action",
    "description",
  ];
  const updates = mutableFields
    .filter((field) => validation.data[field] !== undefined)
    .map((field) => ({ field, value: validation.data[field] }));
  const values: unknown[] = updates.map(({ value }) => value);
  const assignments = updates.map(
    ({ field }, index) => `${field} = $${index + 1}`,
  );
  values.push(permissionId);

  try {
    const result = await pool.query(
      `UPDATE ${PERMISSION_TABLE}
       SET ${assignments.join(", ")}, updated_at = CURRENT_TIMESTAMP
       WHERE permission_id = $${values.length}
       RETURNING ${PERMISSION_COLUMNS}`,
      values,
    );

    if (result.rowCount === 0) {
      return NextResponse.json(
        { error: "Permission not found" },
        { status: 404 },
      );
    }

    return NextResponse.json({
      message: "Permission updated",
      permission: serializePermission(result.rows[0]),
    });
  } catch (error) {
    if (getPermissionDatabaseErrorCode(error) === "23505") {
      return NextResponse.json(
        { error: "A permission with these keys already exists" },
        { status: 409 },
      );
    }

    console.error("Failed to update permission", error);
    return NextResponse.json(
      { error: "Unable to update permission" },
      { status: 500 },
    );
  }
}
