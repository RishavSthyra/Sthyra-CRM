import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { authenticateRequest, AUTH_USER_COLUMNS } from "@/lib/auth";
import { ProfileWrite, validateProfilePayload } from "@/lib/authValidation";
import { getUserDatabaseErrorCode } from "@/lib/users";

export async function GET(request: NextRequest) {
  const authentication = await authenticateRequest(request);
  if (!authentication.ok) {
    return authentication.response;
  }

  const response = NextResponse.json({ user: authentication.auth.user });
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export async function PATCH(request: NextRequest) {
  const authentication = await authenticateRequest(request);
  if (!authentication.ok) {
    return authentication.response;
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
  const validation = validateProfilePayload(body);
  if (!validation.ok) {
    return NextResponse.json(
      { error: "Validation failed", details: validation.errors },
      { status: 422 },
    );
  }

  const fields: (keyof ProfileWrite)[] = [
    "username",
    "first_name",
    "last_name",
    "email",
    "phone",
  ];
  const updates = fields
    .filter((field) => validation.data[field] !== undefined)
    .map((field) => ({ field, value: validation.data[field] }));
  const values = updates.map(({ value }) => value);
  const assignments = updates.map(
    ({ field }, index) => `${field} = $${index + 1}`,
  );
  values.push(authentication.auth.user.user_id);

  try {
    const result = await pool.query(
      `UPDATE users u
       SET ${assignments.join(", ")}, updated_at = CURRENT_TIMESTAMP
       WHERE u.user_id = $${values.length} AND u.deleted_at IS NULL
       RETURNING ${AUTH_USER_COLUMNS}`,
      values,
    );
    const response = NextResponse.json({
      message: "Profile updated",
      user: result.rows[0],
    });
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error) {
    if (getUserDatabaseErrorCode(error) === "23505") {
      return NextResponse.json(
        { error: "A user with this username or email already exists" },
        { status: 409 },
      );
    }
    console.error("Failed to update own profile", error);
    return NextResponse.json(
      { error: "Unable to update profile" },
      { status: 500 },
    );
  }
}
