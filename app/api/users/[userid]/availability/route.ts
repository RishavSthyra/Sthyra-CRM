import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { validateAvailabilityPayload } from "@/lib/availability";
import { parseUserId } from "@/lib/users";

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
      `SELECT
         u.user_id,
         COALESCE(a.timezone, 'Asia/Kolkata') AS timezone,
         COALESCE(a.weekly_schedule, '{}'::jsonb) AS weekly_schedule,
         COALESCE(a.is_available, TRUE) AS is_available,
         a.created_at,
         a.updated_at,
         (a.user_id IS NOT NULL) AS configured
       FROM users u
       LEFT JOIN user_availability a ON a.user_id = u.user_id
       WHERE u.user_id = $1 AND u.deleted_at IS NULL`,
      [userId],
    );
    if (result.rowCount === 0) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }
    return NextResponse.json({ availability: result.rows[0] });
  } catch (error) {
    console.error("Failed to retrieve user availability", error);
    return NextResponse.json(
      { error: "Unable to retrieve user availability" },
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

  const validation = validateAvailabilityPayload(body);
  if (!validation.ok) {
    return NextResponse.json(
      { error: "Validation failed", details: validation.errors },
      { status: 422 },
    );
  }

  const availability = validation.data;
  try {
    const userResult = await pool.query(
      "SELECT user_id FROM users WHERE user_id = $1 AND deleted_at IS NULL",
      [userId],
    );
    if (userResult.rowCount === 0) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const result = await pool.query(
      `INSERT INTO user_availability (
         user_id,
         timezone,
         weekly_schedule,
         is_available
       )
       VALUES (
         $1,
         COALESCE($2, 'Asia/Kolkata'),
         COALESCE($3::jsonb, '{}'::jsonb),
         COALESCE($4, TRUE)
       )
       ON CONFLICT (user_id) DO UPDATE
       SET timezone = COALESCE($2, user_availability.timezone),
           weekly_schedule = COALESCE($3::jsonb, user_availability.weekly_schedule),
           is_available = COALESCE($4, user_availability.is_available),
           updated_at = CURRENT_TIMESTAMP
       RETURNING
         user_id,
         timezone,
         weekly_schedule,
         is_available,
         created_at,
         updated_at,
         TRUE AS configured`,
      [
        userId,
        availability.timezone ?? null,
        availability.weekly_schedule === undefined
          ? null
          : JSON.stringify(availability.weekly_schedule),
        availability.is_available ?? null,
      ],
    );
    return NextResponse.json({
      message: "User availability updated",
      availability: result.rows[0],
    });
  } catch (error) {
    console.error("Failed to update user availability", error);
    return NextResponse.json(
      { error: "Unable to update user availability" },
      { status: 500 },
    );
  }
}
