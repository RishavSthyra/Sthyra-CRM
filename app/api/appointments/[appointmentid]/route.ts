import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import {
  APPOINTMENT_COLUMNS,
  ActivityReferenceError,
  AppointmentInput,
  parseActivityUuid,
  recordActivity,
  validateActivityReferences,
  validateAppointmentPayload,
} from "@/lib/activities";
import {
  canAccessOperationsEntity,
  requireOperationsContext,
} from "@/lib/operationsAccess";
import { canAccessProject } from "@/lib/projectAccess";

type Context = { params: Promise<{ appointmentid: string }> };

export async function GET(request: NextRequest, context: Context) {
  const scope = await requireOperationsContext(request);
  if (!scope.ok) return scope.response;
  const appointmentId = parseActivityUuid((await context.params).appointmentid);
  if (!appointmentId)
    return NextResponse.json(
      { error: "appointmentId must be a valid UUID" },
      { status: 400 },
    );
  try {
    const result = await pool.query(
      `SELECT ${APPOINTMENT_COLUMNS}, p.project_name, c.first_name, c.last_name, c.email, c.phone_number, u.first_name AS assignee_first_name, u.last_name AS assignee_last_name, team.name AS assigned_team_name FROM appointments ap JOIN projects p ON p.project_id=ap.project_id LEFT JOIN contacts c ON c.contact_id=ap.contact_id LEFT JOIN users u ON u.user_id=ap.assigned_to_user_id LEFT JOIN teams team ON team.team_id=ap.assigned_to_team_id WHERE ap.appointment_id=$1`,
      [appointmentId],
    );
    if (!result.rowCount)
      return NextResponse.json(
        { error: "Appointment not found" },
        { status: 404 },
      );
    const appointment = result.rows[0];
    if (
      !canAccessOperationsEntity(
        scope.context.access,
        Number(appointment.company_id),
        Number(appointment.project_id),
      )
    )
      return NextResponse.json(
        { error: "You do not have access to this appointment" },
        { status: 403 },
      );
    return NextResponse.json({ appointment });
  } catch (error) {
    console.error("Failed to retrieve appointment", error);
    return NextResponse.json(
      { error: "Unable to retrieve appointment" },
      { status: 500 },
    );
  }
}

export async function PATCH(request: NextRequest, context: Context) {
  const scope = await requireOperationsContext(request);
  if (!scope.ok) return scope.response;
  const appointmentId = parseActivityUuid((await context.params).appointmentid);
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
  const partial = validateAppointmentPayload(body, true);
  if (!partial.ok)
    return NextResponse.json(
      { error: "Validation failed", details: partial.errors },
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
    if (["cancelled", "completed"].includes(current.status)) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: "Completed or cancelled appointments cannot be edited" },
        { status: 409 },
      );
    }
    const merged = {
      project_id: partial.data.project_id ?? current.project_id,
      lead_id:
        partial.data.lead_id !== undefined
          ? partial.data.lead_id
          : current.lead_id,
      contact_id:
        partial.data.contact_id !== undefined
          ? partial.data.contact_id
          : current.contact_id,
      appointment_type:
        partial.data.appointment_type ?? current.appointment_type,
      title: partial.data.title ?? current.title,
      description:
        partial.data.description !== undefined
          ? partial.data.description
          : current.description,
      location:
        partial.data.location !== undefined
          ? partial.data.location
          : current.location,
      meeting_url:
        partial.data.meeting_url !== undefined
          ? partial.data.meeting_url
          : current.meeting_url,
      starts_at: partial.data.starts_at ?? current.starts_at,
      ends_at: partial.data.ends_at ?? current.ends_at,
      timezone: partial.data.timezone ?? current.timezone,
      organizer_user_id:
        partial.data.organizer_user_id !== undefined
          ? partial.data.organizer_user_id
          : current.organizer_user_id,
      assigned_to_user_id:
        partial.data.assigned_to_user_id !== undefined
          ? partial.data.assigned_to_user_id
          : current.assigned_to_user_id,
      assigned_to_team_id:
        partial.data.assigned_to_team_id !== undefined
          ? partial.data.assigned_to_team_id
          : current.assigned_to_team_id,
    };
    const complete = validateAppointmentPayload(merged, false);
    if (!complete.ok) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: "Validation failed", details: complete.errors },
        { status: 422 },
      );
    }
    if (
      !canAccessProject(
        scope.context.access,
        complete.data.project_id as number,
      )
    ) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: "You do not have access to the target project" },
        { status: 403 },
      );
    }
    await validateActivityReferences(
      client,
      scope.context.access.company.company_id,
      complete.data,
    );
    const fields: (keyof AppointmentInput)[] = [
      "project_id",
      "lead_id",
      "contact_id",
      "appointment_type",
      "title",
      "description",
      "location",
      "meeting_url",
      "starts_at",
      "ends_at",
      "timezone",
      "organizer_user_id",
      "assigned_to_user_id",
      "assigned_to_team_id",
    ];
    const updates = fields.filter((field) => partial.data[field] !== undefined);
    const values = updates.map((field) => partial.data[field]);
    values.push(scope.context.userId, appointmentId);
    const assignments = updates.map((field, index) => `${field}=$${index + 1}`);
    const result = await client.query(
      `UPDATE appointments SET ${assignments.join(", ")}, updated_by=$${values.length - 1}, updated_at=CURRENT_TIMESTAMP WHERE appointment_id=$${values.length} RETURNING *`,
      values,
    );
    const appointment = result.rows[0];
    await recordActivity(
      client,
      appointment,
      "appointment",
      "appointment_updated",
      `Appointment updated: ${appointment.title}`,
      scope.context.userId,
      { metadata: { fields: updates } },
    );
    await client.query("COMMIT");
    return NextResponse.json({ message: "Appointment updated", appointment });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    if (error instanceof ActivityReferenceError)
      return NextResponse.json({ error: error.message }, { status: 422 });
    console.error("Failed to update appointment", error);
    return NextResponse.json(
      { error: "Unable to update appointment" },
      { status: 500 },
    );
  } finally {
    client.release();
  }
}
