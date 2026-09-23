import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { authenticateRequest } from "@/lib/auth";
import { isObject } from "@/utils/isObject";

const COLUMNS = `
  user_id, compact_mode, email_notifications, push_notifications,
  lead_assignment_notifications, task_reminders, appointment_reminders,
  digest_frequency, default_landing_page, created_at, updated_at
`;

const DEFAULTS = {
  compact_mode: false,
  email_notifications: true,
  push_notifications: true,
  lead_assignment_notifications: true,
  task_reminders: true,
  appointment_reminders: true,
  digest_frequency: "daily",
  default_landing_page: "dashboard",
};

export async function GET(request: NextRequest) {
  const authentication = await authenticateRequest(request);
  if (!authentication.ok) return authentication.response;
  try {
    const result = await pool.query(
      `SELECT ${COLUMNS} FROM user_preferences WHERE user_id=$1`,
      [authentication.auth.user.user_id],
    );
    const response = NextResponse.json({
      preferences: result.rows[0] ?? {
        user_id: authentication.auth.user.user_id,
        ...DEFAULTS,
      },
    });
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error) {
    console.error("Failed to retrieve user preferences", error);
    return NextResponse.json(
      { error: "Unable to retrieve preferences" },
      { status: 500 },
    );
  }
}

export async function PATCH(request: NextRequest) {
  const authentication = await authenticateRequest(request);
  if (!authentication.ok) return authentication.response;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Request body must contain valid JSON" },
      { status: 400 },
    );
  }
  if (!isObject(body) || Array.isArray(body)) {
    return NextResponse.json(
      { error: "Request body must be a JSON object" },
      { status: 422 },
    );
  }
  const booleanFields = [
    "compact_mode",
    "email_notifications",
    "push_notifications",
    "lead_assignment_notifications",
    "task_reminders",
    "appointment_reminders",
  ] as const;
  const allowed = new Set([
    ...booleanFields,
    "digest_frequency",
    "default_landing_page",
  ]);
  const errors = Object.keys(body)
    .filter((field) => !allowed.has(field))
    .map((field) => `Unknown field: ${field}`);
  for (const field of booleanFields) {
    if (body[field] !== undefined && typeof body[field] !== "boolean") {
      errors.push(`${field} must be a boolean`);
    }
  }
  if (
    body.digest_frequency !== undefined &&
    !["never", "daily", "weekly"].includes(String(body.digest_frequency))
  ) {
    errors.push("digest_frequency must be never, daily, or weekly");
  }
  if (
    body.default_landing_page !== undefined &&
    !["dashboard", "leads", "activity", "calendar"].includes(
      String(body.default_landing_page),
    )
  ) {
    errors.push(
      "default_landing_page must be dashboard, leads, activity, or calendar",
    );
  }
  if (!Object.keys(body).length) errors.push("At least one field is required");
  if (errors.length) {
    return NextResponse.json(
      { error: "Validation failed", details: errors },
      { status: 422 },
    );
  }
  const values = booleanFields.map((field) => body[field] ?? null);
  values.push(
    body.digest_frequency ?? null,
    body.default_landing_page ?? null,
    authentication.auth.user.user_id,
  );
  try {
    const result = await pool.query(
      `INSERT INTO user_preferences (
         compact_mode, email_notifications, push_notifications,
         lead_assignment_notifications, task_reminders, appointment_reminders,
         digest_frequency, default_landing_page, user_id
       ) VALUES (
         COALESCE($1, FALSE), COALESCE($2, TRUE), COALESCE($3, TRUE),
         COALESCE($4, TRUE), COALESCE($5, TRUE), COALESCE($6, TRUE),
         COALESCE($7, 'daily'), COALESCE($8, 'dashboard'), $9
       )
       ON CONFLICT (user_id) DO UPDATE SET
         compact_mode=COALESCE($1, user_preferences.compact_mode),
         email_notifications=COALESCE($2, user_preferences.email_notifications),
         push_notifications=COALESCE($3, user_preferences.push_notifications),
         lead_assignment_notifications=COALESCE($4, user_preferences.lead_assignment_notifications),
         task_reminders=COALESCE($5, user_preferences.task_reminders),
         appointment_reminders=COALESCE($6, user_preferences.appointment_reminders),
         digest_frequency=COALESCE($7, user_preferences.digest_frequency),
         default_landing_page=COALESCE($8, user_preferences.default_landing_page),
         updated_at=CURRENT_TIMESTAMP
       RETURNING ${COLUMNS}`,
      values,
    );
    return NextResponse.json({
      message: "Preferences updated",
      preferences: result.rows[0],
    });
  } catch (error) {
    console.error("Failed to update user preferences", error);
    return NextResponse.json(
      { error: "Unable to update preferences" },
      { status: 500 },
    );
  }
}
