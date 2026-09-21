import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import {
  getRoleDatabaseErrorCode,
  ROLE_COLUMNS,
  serializeRole,
  validateRolePayload,
} from "@/lib/roles";
import { parsePositiveInteger } from "@/utils/parsePositiveInteger";

export async function GET(request: NextRequest) {
  const page = parsePositiveInteger(request.nextUrl.searchParams.get("page"), 1);
  const limit = parsePositiveInteger(
    request.nextUrl.searchParams.get("limit"),
    50,
  );
  const includeInactiveValue = request.nextUrl.searchParams.get("includeInactive");

  if (page === null || limit === null || limit > 100) {
    return NextResponse.json(
      { error: "page and limit must be positive integers; limit cannot exceed 100" },
      { status: 400 },
    );
  }

  if (
    includeInactiveValue !== null &&
    includeInactiveValue !== "true" &&
    includeInactiveValue !== "false"
  ) {
    return NextResponse.json(
      { error: "includeInactive must be true or false" },
      { status: 400 },
    );
  }

  const filters: string[] = [];
  const values: unknown[] = [];

  if (includeInactiveValue !== "true") filters.push("is_active = TRUE");

  const search = request.nextUrl.searchParams.get("search")?.trim();
  if (search) {
    values.push(`%${search}%`);
    const parameter = `$${values.length}`;
    filters.push(`(role_key ILIKE ${parameter} OR role_name ILIKE ${parameter})`);
  }

  const whereClause = filters.length > 0 ? `WHERE ${filters.join(" AND ")}` : "";
  const offset = (page - 1) * limit;

  try {
    const countResult = await pool.query(
      `SELECT COUNT(*)::integer AS total FROM roles ${whereClause}`,
      values,
    );
    const listValues = [...values, limit, offset];
    const result = await pool.query(
      `SELECT ${ROLE_COLUMNS}
       FROM roles
       ${whereClause}
       ORDER BY role_name ASC, role_id ASC
       LIMIT $${listValues.length - 1}
       OFFSET $${listValues.length}`,
      listValues,
    );
    const total = Number(countResult.rows[0]?.total ?? 0);

    return NextResponse.json({
      roles: result.rows.map(serializeRole),
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  } catch (error) {
    console.error("Failed to list roles", error);
    return NextResponse.json(
      { error: "Unable to retrieve roles" },
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

  const validation = validateRolePayload(body, { partial: false });
  if (!validation.ok) {
    return NextResponse.json(
      { error: "Validation failed", details: validation.errors },
      { status: 422 },
    );
  }

  const role = validation.data;
  try {
    const result = await pool.query(
      `INSERT INTO roles (role_key, role_name, description)
       VALUES ($1, $2, $3)
       RETURNING ${ROLE_COLUMNS}`,
      [role.role_key, role.role_name, role.description ?? null],
    );

    return NextResponse.json(
      { message: "Role created", role: serializeRole(result.rows[0]) },
      { status: 201 },
    );
  } catch (error) {
    const code = getRoleDatabaseErrorCode(error);
    if (code === "23505") {
      return NextResponse.json(
        { error: "A role with this role_key already exists" },
        { status: 409 },
      );
    }
    if (code === "23514") {
      return NextResponse.json(
        { error: "Role data violates a database constraint" },
        { status: 422 },
      );
    }

    console.error("Failed to create role", error);
    return NextResponse.json(
      { error: "Unable to create role" },
      { status: 500 },
    );
  }
}
