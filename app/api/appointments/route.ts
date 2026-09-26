import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import {
  APPOINTMENT_COLUMNS,
  ActivityReferenceError,
  parseActivityUuid,
  recordActivity,
  validateActivityReferences,
  validateAppointmentPayload,
} from "@/lib/activities";
import { requireOperationsContext } from "@/lib/operationsAccess";
import { canAccessProject, getAccessibleProjectIds } from "@/lib/projectAccess";
import { parsePagination } from "@/utils/parsePagination";
import { parsePositiveInteger } from "@/utils/parsePositiveInteger";

export async function GET(request: NextRequest) {
  const scope = await requireOperationsContext(request);
  if (!scope.ok) return scope.response;
  const pagination = parsePagination(request.nextUrl.searchParams);
  if (!pagination.ok)
    return NextResponse.json({ error: pagination.error }, { status: 400 });
  const values: unknown[] = [getAccessibleProjectIds(scope.context.access)];
  const filters = ["ap.project_id=ANY($1::integer[])"];
  const projectValue = request.nextUrl.searchParams.get("project_id");
  if (projectValue) {
    const projectId = parsePositiveInteger(projectValue);
    if (!projectId || !canAccessProject(scope.context.access, projectId))
      return NextResponse.json(
        { error: "Invalid or inaccessible project_id" },
        { status: 400 },
      );
    values.push(projectId);
    filters.push(`ap.project_id=$${values.length}`);
  }
  const status = request.nextUrl.searchParams.get("status");
  if (status) {
    if (
      ![
        "scheduled",
        "confirmed",
        "rescheduled",
        "checked_in",
        "cancelled",
        "completed",
        "no_show",
      ].includes(status)
    )
      return NextResponse.json(
        { error: "Invalid appointment status" },
        { status: 400 },
      );
    values.push(status);
    filters.push(`ap.status=$${values.length}`);
  }
  const type = request.nextUrl.searchParams.get("appointment_type");
  if (type) {
    if (!["call", "meeting", "site_visit", "video", "other"].includes(type))
      return NextResponse.json(
        { error: "Invalid appointment_type" },
        { status: 400 },
      );
    values.push(type);
    filters.push(`ap.appointment_type=$${values.length}`);
  }
  for (const field of [
    "lead_id",
    "opportunity_id",
    "contact_id",
    "assigned_to_user_id",
    "assigned_to_team_id",
    "organizer_user_id",
  ] as const) {
    const raw = request.nextUrl.searchParams.get(field);
    if (!raw) continue;
    const id = parseActivityUuid(raw);
    if (!id)
      return NextResponse.json(
        { error: `${field} must be a valid UUID` },
        { status: 400 },
      );
    values.push(id);
    filters.push(`ap.${field}=$${values.length}`);
  }
  for (const [parameter, operator] of [
    ["from", ">="],
    ["to", "<="],
  ] as const) {
    const raw = request.nextUrl.searchParams.get(parameter);
    if (!raw) continue;
    if (Number.isNaN(Date.parse(raw)))
      return NextResponse.json(
        { error: `${parameter} must be a valid date-time` },
        { status: 400 },
      );
    values.push(new Date(raw).toISOString());
    filters.push(`ap.starts_at ${operator} $${values.length}`);
  }
  const search = request.nextUrl.searchParams.get("search")?.trim();
  if (search) {
    values.push(`%${search}%`);
    filters.push(
      `(ap.title ILIKE $${values.length} OR ap.description ILIKE $${values.length} OR ap.location ILIKE $${values.length})`,
    );
  }
  const where = `WHERE ${filters.join(" AND ")}`;
  try {
    const count = await pool.query(
      `SELECT COUNT(*)::integer AS total FROM appointments ap ${where}`,
      values,
    );
    const listValues = [...values, pagination.limit, pagination.offset];
    const result = await pool.query(
      `SELECT ${APPOINTMENT_COLUMNS}, p.project_name, c.first_name, c.last_name,
        u.first_name AS assignee_first_name, u.last_name AS assignee_last_name,
        organizer.first_name AS organizer_first_name,
        organizer.last_name AS organizer_last_name,
        team.name AS assigned_team_name
       FROM appointments ap JOIN projects p ON p.project_id=ap.project_id
       LEFT JOIN contacts c ON c.contact_id=ap.contact_id
       LEFT JOIN users u ON u.user_id=ap.assigned_to_user_id
       LEFT JOIN users organizer ON organizer.user_id=ap.organizer_user_id
       LEFT JOIN teams team ON team.team_id=ap.assigned_to_team_id
       ${where} ORDER BY ap.starts_at, ap.appointment_id
       LIMIT $${listValues.length - 1} OFFSET $${listValues.length}`,
      listValues,
    );
    const total = Number(count.rows[0]?.total ?? 0);
    return NextResponse.json({
      appointments: result.rows,
      pagination: {
        page: pagination.page,
        limit: pagination.limit,
        total,
        totalPages: Math.ceil(total / pagination.limit),
      },
    });
  } catch (error) {
    console.error("Failed to list appointments", error);
    return NextResponse.json(
      { error: "Unable to retrieve appointments" },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  const scope = await requireOperationsContext(request);
  if (!scope.ok) return scope.response;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Request body must contain valid JSON" },
      { status: 400 },
    );
  }
  const validation = validateAppointmentPayload(body, false);
  if (!validation.ok)
    return NextResponse.json(
      { error: "Validation failed", details: validation.errors },
      { status: 422 },
    );
  if (validation.data.appointment_type === "site_visit")
    return NextResponse.json(
      { error: "Create site visits through POST /api/site-visits" },
      { status: 409 },
    );
  if (
    !canAccessProject(
      scope.context.access,
      validation.data.project_id as number,
    )
  )
    return NextResponse.json(
      { error: "You do not have access to this project" },
      { status: 403 },
    );
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await validateActivityReferences(
      client,
      scope.context.access.company.company_id,
      validation.data,
    );
    const result = await client.query(
      `INSERT INTO appointments (company_id, project_id, lead_id, opportunity_id, contact_id,
       appointment_type, title, description, location, meeting_url, starts_at,
       ends_at, timezone, organizer_user_id, assigned_to_user_id,
       assigned_to_team_id, created_by, updated_by)
       VALUES (
         $1,$2,
         COALESCE($3,(SELECT lead_id FROM opportunities WHERE opportunity_id=$4)),
         $4,
         COALESCE($5,
           (SELECT contact_id FROM opportunities WHERE opportunity_id=$4),
           (SELECT contact_id FROM leads WHERE lead_id=$3)
         ),
         $6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$17
       ) RETURNING *`,
      [
        scope.context.access.company.company_id,
        validation.data.project_id,
        validation.data.lead_id ?? null,
        validation.data.opportunity_id ?? null,
        validation.data.contact_id ?? null,
        validation.data.appointment_type ?? "meeting",
        validation.data.title,
        validation.data.description ?? null,
        validation.data.location ?? null,
        validation.data.meeting_url ?? null,
        validation.data.starts_at,
        validation.data.ends_at,
        validation.data.timezone ?? "Asia/Kolkata",
        validation.data.organizer_user_id ?? scope.context.userId,
        validation.data.assigned_to_user_id ?? null,
        validation.data.assigned_to_team_id ?? null,
        scope.context.userId,
      ],
    );
    const appointment = result.rows[0];
    await recordActivity(
      client,
      appointment,
      "appointment",
      "appointment_created",
      `Appointment scheduled: ${appointment.title}`,
      scope.context.userId,
      {
        metadata: {
          starts_at: appointment.starts_at,
          ends_at: appointment.ends_at,
          appointment_type: appointment.appointment_type,
        },
      },
    );
    await client.query("COMMIT");
    return NextResponse.json(
      { message: "Appointment created", appointment },
      { status: 201 },
    );
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    if (error instanceof ActivityReferenceError)
      return NextResponse.json({ error: error.message }, { status: 422 });
    console.error("Failed to create appointment", error);
    return NextResponse.json(
      { error: "Unable to create appointment" },
      { status: 500 },
    );
  } finally {
    client.release();
  }
}
