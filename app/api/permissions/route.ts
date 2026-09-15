import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import {
  getPermissionDatabaseErrorCode,
  PERMISSION_COLUMNS,
  serializePermission,
  validatePermissionPayload,
} from "@/lib/permissions";

const PERMISSION_TABLE = "permissions";

export async function GET() {
  try {
    const result = await pool.query(
      `SELECT ${PERMISSION_COLUMNS}
       FROM ${PERMISSION_TABLE}
       ORDER BY feature_key ASC, action ASC, permission_key ASC, permission_id ASC`,
    );

    return NextResponse.json({
      message: "Listing all permissions",
      permissions: result.rows.map(serializePermission),
    });
  } catch (error) {
    console.error("Failed to list permissions", error);
    return NextResponse.json(
      { error: "Unable to retrieve permissions" },
      { status: 500 },
    );
  }
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

  const validation = validatePermissionPayload(body, { partial: false });
  if (!validation.ok) {
    return NextResponse.json(
      { error: "Validation failed", details: validation.errors },
      { status: 422 },
    );
  }

  const permission = validation.data;

  try {
    const result = await pool.query(
      `INSERT INTO ${PERMISSION_TABLE} (
        permission_key,
        permission_name,
        feature_key,
        action,
        description
      )
      VALUES ($1, $2, $3, $4, $5)
      RETURNING ${PERMISSION_COLUMNS}`,
      [
        permission.permission_key,
        permission.permission_name,
        permission.feature_key,
        permission.action,
        permission.description ?? null,
      ],
    );

    return NextResponse.json(
      {
        message: "Permission created",
        permission: serializePermission(result.rows[0]),
      },
      { status: 201 },
    );
  } catch (error) {
    if (getPermissionDatabaseErrorCode(error) === "23505") {
      return NextResponse.json(
        { error: "A permission with these keys already exists" },
        { status: 409 },
      );
    }

    console.error("Failed to create permission", error);
    return NextResponse.json(
      { error: "Unable to create permission" },
      { status: 500 },
    );
  }
}
