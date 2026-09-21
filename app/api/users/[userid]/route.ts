import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import {
  getUserDatabaseErrorCode,
  parseUserId,
  USER_COLUMNS,
  UserField,
  validateUserPayload,
} from "@/lib/users";

type UserContext = {
  params: Promise<{ userid: string }>;
};

export async function GET(_request: NextRequest, context: UserContext) {
  const { userid } = await context.params;
  const userId = parseUserId(userid);
  if (userId === null) {
    return NextResponse.json(
      { error: "userid must be a valid UUID" },
      { status: 400 },
    );
  }

  try {
    const result = await pool.query(
      `SELECT ${USER_COLUMNS}
       FROM users
       WHERE user_id = $1 AND deleted_at IS NULL`,
      [userId],
    );
    if (result.rowCount === 0) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }
    return NextResponse.json({ user: result.rows[0] });
  } catch (error) {
    console.error("Failed to retrieve user", error);
    return NextResponse.json(
      { error: "Unable to retrieve user" },
      { status: 500 },
    );
  }
}

export async function PATCH(request: NextRequest, context: UserContext) {
  const { userid } = await context.params;
  const userId = parseUserId(userid);
  if (userId === null) {
    return NextResponse.json(
      { error: "userid must be a valid UUID" },
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

  const validation = validateUserPayload(body, { partial: true });
  if (!validation.ok) {
    return NextResponse.json(
      { error: "Validation failed", details: validation.errors },
      { status: 422 },
    );
  }

  const mutableFields: UserField[] = [
    "team_id",
    "role_id",
    "username",
    "first_name",
    "last_name",
    "email",
    "phone",
    "password_hash",
    "is_active",
  ];
  const updates = mutableFields
    .filter((field) => validation.data[field] !== undefined)
    .map((field) => ({ field, value: validation.data[field] }));
  const values: unknown[] = updates.map(({ value }) => value);
  const assignments = updates.map(
    ({ field }, index) => `${field} = $${index + 1}`,
  );
  values.push(userId);

  try {
    const result = await pool.query(
      `UPDATE users
       SET ${assignments.join(", ")}, updated_at = CURRENT_TIMESTAMP
       WHERE user_id = $${values.length} AND deleted_at IS NULL
       RETURNING ${USER_COLUMNS}`,
      values,
    );
    if (result.rowCount === 0) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }
    return NextResponse.json({ message: "User updated", user: result.rows[0] });
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

    console.error("Failed to update user", error);
    return NextResponse.json(
      { error: "Unable to update user" },
      { status: 500 },
    );
  }
}
