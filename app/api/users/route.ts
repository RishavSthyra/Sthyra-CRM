import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { isUuid } from "@/lib/permissions";
import { parsePositiveInteger } from "@/utils/parsePositiveInteger";
import {
  getUserDatabaseErrorCode,
  USER_COLUMNS,
  validateUserPayload,
} from "@/lib/users";

export async function GET(request: NextRequest) {
  const parameters = request.nextUrl.searchParams;
  const page = parsePositiveInteger(parameters.get("page"), 1);
  const limit = parsePositiveInteger(parameters.get("limit"), 20);
  const isActiveValue = parameters.get("is_active");

  if (page === null || limit === null || limit > 100) {
    return NextResponse.json(
      { error: "page and limit must be positive integers; limit cannot exceed 100" },
      { status: 400 },
    );
  }

  if (
    isActiveValue !== null &&
    isActiveValue !== "true" &&
    isActiveValue !== "false"
  ) {
    return NextResponse.json(
      { error: "is_active must be true or false" },
      { status: 400 },
    );
  }

  const filters = ["deleted_at IS NULL"];

  const values: unknown[] = [];

  const addFilter = (clause: string, value: unknown) => {
    values.push(value);
    filters.push(clause.replace("?", `$${values.length}`));
  };

  const search = parameters.get("search")?.trim();

  if (search) {
    values.push(`%${search}%`);
    const placeholder = `$${values.length}`;
    filters.push(
      `(username ILIKE ${placeholder} OR first_name ILIKE ${placeholder} OR last_name ILIKE ${placeholder} OR email ILIKE ${placeholder} OR phone ILIKE ${placeholder})`,
    );
  }

  const teamId = parameters.get("team_id");
  if (teamId !== null) {
    if (!isUuid(teamId)) {
      return NextResponse.json(
        { error: "team_id must be a valid UUID" },
        { status: 400 },
      );
    }
    addFilter("team_id = ?", teamId);
  }

  const roleId = parameters.get("role_id");
  if (roleId !== null) {
    if (!isUuid(roleId)) {
      return NextResponse.json(
        { error: "role_id must be a valid UUID" },
        { status: 400 },
      );
    }
    addFilter("role_id = ?", roleId);
  }

  if (isActiveValue !== null) {
    addFilter("is_active = ?", isActiveValue === "true");
  }

  const whereClause = `WHERE ${filters.join(" AND ")}`;
  const offset = (page - 1) * limit;

  try {
    const countResult = await pool.query(
      `SELECT COUNT(*)::integer AS total FROM users ${whereClause}`,
      values,
    );
    const listValues = [...values, limit, offset];
    const result = await pool.query(
      `SELECT ${USER_COLUMNS}
       FROM users
       ${whereClause}
       ORDER BY created_at DESC, user_id ASC
       LIMIT $${listValues.length - 1}
       OFFSET $${listValues.length}`,
      listValues,
    );
    const total = Number(countResult.rows[0]?.total ?? 0);

    return NextResponse.json({
      users: result.rows,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        hasNextPage: page * limit < total,
        hasPreviousPage: page > 1,
      },
    });
  } catch (error) {
    console.error("Failed to list users", error);
    return NextResponse.json(
      { error: "Unable to retrieve users" },
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

  const validation = validateUserPayload(body, { partial: false });
  if (!validation.ok) {
    return NextResponse.json(
      { error: "Validation failed", details: validation.errors },
      { status: 422 },
    );
  }

  const user = validation.data;
  try {
    const result = await pool.query(
      `INSERT INTO users (
        team_id,
        role_id,
        username,
        first_name,
        last_name,
        email,
        phone,
        password_hash,
        is_active
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING ${USER_COLUMNS}`,
      [
        user.team_id ?? null,
        user.role_id,
        user.username,
        user.first_name,
        user.last_name ?? null,
        user.email,
        user.phone ?? null,
        user.password_hash ?? null,
        user.is_active,
      ],
    );

    return NextResponse.json(
      { message: "User created", user: result.rows[0] },
      { status: 201 },
    );
  } catch (error) {
    const code = getUserDatabaseErrorCode(error);
    if (code === "23505") {
      return NextResponse.json(
        { error: "A user with this username or email already exists" },
        { status: 409 },
      );
    }
    if (code === "23503") {
      return NextResponse.json(
        { error: "The selected role or team does not exist" },
        { status: 422 },
      );
    }

    console.error("Failed to create user", error);
    return NextResponse.json(
      { error: "Unable to create user" },
      { status: 500 },
    );
  }
}
