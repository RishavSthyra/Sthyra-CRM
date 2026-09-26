import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { parseActivityUuid, recordActivity } from "@/lib/activities";
import {
  canAccessOperationsEntity,
  requireOperationsContext,
} from "@/lib/operationsAccess";
import { isObject } from "@/utils/isObject";
import { validateText } from "@/utils/validateText";

export async function changeAppointmentState(
  request: NextRequest,
  rawAppointmentId: string,
  action: "confirm" | "cancel" | "complete",
) {
  const scope = await requireOperationsContext(request);
  if (!scope.ok) return scope.response;
  const appointmentId = parseActivityUuid(rawAppointmentId);
  if (!appointmentId)
    return NextResponse.json(
      { error: "appointmentId must be a valid UUID" },
      { status: 400 },
    );
  let body: unknown = {};
  try {
    const text = await request.text();
    body = text ? JSON.parse(text) : {};
  } catch {
    return NextResponse.json(
      { error: "Request body must contain valid JSON" },
      { status: 400 },
    );
  }
  if (!isObject(body) || Array.isArray(body))
    return NextResponse.json(
      { error: "Request body must be a JSON object" },
      { status: 422 },
    );
  const errors: string[] = [];
  const reason = validateText(body.reason, "reason", 5000, true, errors);
  Object.keys(body)
    .filter((key) => key !== "reason")
    .forEach((key) => errors.push(`Unknown field: ${key}`));
  if (action === "cancel" && !reason) errors.push("reason is required");
  if (errors.length)
    return NextResponse.json(
      { error: "Validation failed", details: errors },
      { status: 422 },
    );
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const currentResult = await client.query(
      "SELECT * FROM appointments WHERE appointment_id=$1 FOR UPDATE",
      [appointmentId],
    );
    if (!currentResult.rowCount) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: "Appointment not found" },
        { status: 404 },
      );
    }
    const current = currentResult.rows[0];
    if (
      !canAccessOperationsEntity(
        scope.context.access,
        Number(current.company_id),
        Number(current.project_id),
      )
    ) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: "You do not have access to this appointment" },
        { status: 403 },
      );
    }
    if (current.appointment_type === "site_visit") {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: `Use POST /api/site-visits/${appointmentId}/${action} for site visits` },
        { status: 409 },
      );
    }
    const allowed =
      action === "confirm"
        ? ["scheduled", "rescheduled"]
        : action === "cancel"
          ? ["scheduled", "confirmed", "rescheduled"]
          : ["scheduled", "confirmed", "rescheduled"];
    if (!allowed.includes(current.status)) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        {
          error: `Cannot ${action} an appointment with status ${current.status}`,
        },
        { status: 409 },
      );
    }
    const status =
      action === "confirm"
        ? "confirmed"
        : action === "cancel"
          ? "cancelled"
          : "completed";
    const result = await client.query(
      `UPDATE appointments SET status=$2::varchar, updated_by=$3, updated_at=CURRENT_TIMESTAMP,
       confirmed_at=CASE WHEN $2::varchar='confirmed' THEN CURRENT_TIMESTAMP ELSE confirmed_at END,
       confirmed_by=CASE WHEN $2::varchar='confirmed' THEN $3::uuid ELSE confirmed_by END,
       completed_at=CASE WHEN $2::varchar='completed' THEN CURRENT_TIMESTAMP ELSE NULL END,
       completed_by=CASE WHEN $2::varchar='completed' THEN $3::uuid ELSE NULL END,
       cancelled_at=CASE WHEN $2::varchar='cancelled' THEN CURRENT_TIMESTAMP ELSE NULL END,
       cancelled_by=CASE WHEN $2::varchar='cancelled' THEN $3::uuid ELSE NULL END,
       cancellation_reason=CASE WHEN $2::varchar='cancelled' THEN $4 ELSE cancellation_reason END
       WHERE appointment_id=$1 RETURNING *`,
      [appointmentId, status, scope.context.userId, reason ?? null],
    );
    const appointment = result.rows[0];
    const past =
      action === "confirm"
        ? "confirmed"
        : action === "cancel"
          ? "cancelled"
          : "completed";
    await recordActivity(
      client,
      appointment,
      "appointment",
      `appointment_${past}`,
      `Appointment ${past}: ${appointment.title}`,
      scope.context.userId,
      { description: reason },
    );
    await client.query("COMMIT");
    return NextResponse.json({ message: `Appointment ${past}`, appointment });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    console.error(`Failed to ${action} appointment`, error);
    return NextResponse.json(
      { error: `Unable to ${action} appointment` },
      { status: 500 },
    );
  } finally {
    client.release();
  }
}

export async function rescheduleAppointment(
  request: NextRequest,
  rawAppointmentId: string,
) {
  const scope = await requireOperationsContext(request);
  if (!scope.ok) return scope.response;
  const appointmentId = parseActivityUuid(rawAppointmentId);
  if (!appointmentId)
    return NextResponse.json(
      { error: "appointmentId must be a valid UUID" },
      { status: 400 },
    );
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Request body must contain valid JSON" },
      { status: 400 },
    );
  }
  if (!isObject(body) || Array.isArray(body))
    return NextResponse.json(
      { error: "Request body must be a JSON object" },
      { status: 422 },
    );
  const errors: string[] = [];
  Object.keys(body)
    .filter((key) => !["starts_at", "ends_at", "reason"].includes(key))
    .forEach((key) => errors.push(`Unknown field: ${key}`));
  const startsAt =
    typeof body.starts_at === "string" &&
    !Number.isNaN(Date.parse(body.starts_at))
      ? new Date(body.starts_at).toISOString()
      : null;
  const endsAt =
    typeof body.ends_at === "string" && !Number.isNaN(Date.parse(body.ends_at))
      ? new Date(body.ends_at).toISOString()
      : null;
  if (!startsAt) errors.push("starts_at must be a valid date-time");
  if (!endsAt) errors.push("ends_at must be a valid date-time");
  if (startsAt && endsAt && Date.parse(endsAt) <= Date.parse(startsAt))
    errors.push("ends_at must be after starts_at");
  const reason = validateText(body.reason, "reason", 5000, false, errors);
  if (!reason) errors.push("reason is required");
  if (errors.length)
    return NextResponse.json(
      { error: "Validation failed", details: errors },
      { status: 422 },
    );
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const currentResult = await client.query(
      "SELECT * FROM appointments WHERE appointment_id=$1 FOR UPDATE",
      [appointmentId],
    );
    if (!currentResult.rowCount) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: "Appointment not found" },
        { status: 404 },
      );
    }
    const current = currentResult.rows[0];
    if (
      !canAccessOperationsEntity(
        scope.context.access,
        Number(current.company_id),
        Number(current.project_id),
      )
    ) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: "You do not have access to this appointment" },
        { status: 403 },
      );
    }
    if (current.appointment_type === "site_visit") {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: `Use POST /api/site-visits/${appointmentId}/reschedule for site visits` },
        { status: 409 },
      );
    }
    if (!["scheduled", "confirmed", "rescheduled"].includes(current.status)) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        {
          error: `Cannot reschedule an appointment with status ${current.status}`,
        },
        { status: 409 },
      );
    }
    const result = await client.query(
      `UPDATE appointments SET status='rescheduled', starts_at=$2, ends_at=$3, reschedule_reason=$4, confirmed_at=NULL, confirmed_by=NULL, updated_by=$5, updated_at=CURRENT_TIMESTAMP WHERE appointment_id=$1 RETURNING *`,
      [appointmentId, startsAt, endsAt, reason, scope.context.userId],
    );
    const appointment = result.rows[0];
    await recordActivity(
      client,
      appointment,
      "appointment",
      "appointment_rescheduled",
      `Appointment rescheduled: ${appointment.title}`,
      scope.context.userId,
      {
        description: reason,
        metadata: {
          previous_starts_at: current.starts_at,
          previous_ends_at: current.ends_at,
          starts_at: startsAt,
          ends_at: endsAt,
        },
      },
    );
    await client.query("COMMIT");
    return NextResponse.json({
      message: "Appointment rescheduled",
      appointment,
    });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    console.error("Failed to reschedule appointment", error);
    return NextResponse.json(
      { error: "Unable to reschedule appointment" },
      { status: 500 },
    );
  } finally {
    client.release();
  }
}
