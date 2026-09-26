import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { ActivityReferenceError, recordActivity, validateActivityReferences } from "@/lib/activities";
import { requireOperationsContext } from "@/lib/operationsAccess";
import { canAccessProject, getAccessibleProjectIds } from "@/lib/projectAccess";
import { SITE_VISIT_COLUMNS, SITE_VISIT_STATUSES, addSiteVisitHistory, advanceLeadForSiteVisit, validateSiteVisitPayload } from "@/lib/siteVisits";
import { parsePagination } from "@/utils/parsePagination";
import { parsePositiveInteger } from "@/utils/parsePositiveInteger";

export async function GET(request: NextRequest) {
  const scope = await requireOperationsContext(request); if (!scope.ok) return scope.response;
  const pagination = parsePagination(request.nextUrl.searchParams, 30, 100); if (!pagination.ok) return NextResponse.json({ error: pagination.error }, { status: 400 });
  const values: unknown[] = [getAccessibleProjectIds(scope.context.access)]; const filters = ["ap.project_id=ANY($1::integer[])", "ap.appointment_type='site_visit'"];
  const projectValue = request.nextUrl.searchParams.get("project_id");
  if (projectValue) { const projectId = parsePositiveInteger(projectValue); if (!projectId || !canAccessProject(scope.context.access, projectId)) return NextResponse.json({ error: "Invalid or inaccessible project_id" }, { status: 400 }); values.push(projectId); filters.push(`ap.project_id=$${values.length}`); }
  const status = request.nextUrl.searchParams.get("status");
  if (status) { if (!SITE_VISIT_STATUSES.includes(status as typeof SITE_VISIT_STATUSES[number])) return NextResponse.json({ error: "Invalid site visit status" }, { status: 400 }); values.push(status); filters.push(`ap.status=$${values.length}`); }
  for (const field of ["lead_id", "opportunity_id", "contact_id", "assigned_to_user_id", "assigned_to_team_id", "organizer_user_id"] as const) {
    const raw = request.nextUrl.searchParams.get(field); if (!raw) continue;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(raw)) return NextResponse.json({ error: `${field} must be a valid UUID` }, { status: 400 });
    values.push(raw.toLowerCase()); filters.push(`ap.${field}=$${values.length}`);
  }
  for (const [parameter, operator] of [["from", ">="], ["to", "<="]] as const) { const raw = request.nextUrl.searchParams.get(parameter); if (!raw) continue; if (Number.isNaN(Date.parse(raw))) return NextResponse.json({ error: `${parameter} must be a valid date-time` }, { status: 400 }); values.push(new Date(raw).toISOString()); filters.push(`ap.starts_at ${operator} $${values.length}`); }
  const search = request.nextUrl.searchParams.get("search")?.trim(); if (search) { values.push(`%${search}%`); filters.push(`(ap.title ILIKE $${values.length} OR ap.description ILIKE $${values.length} OR ap.location ILIKE $${values.length})`); }
  const where = `WHERE ${filters.join(" AND ")}`;
  try {
    const count = await pool.query(`SELECT COUNT(*)::integer AS total FROM appointments ap JOIN site_visits sv ON sv.visit_id=ap.appointment_id ${where}`, values);
    const listValues = [...values, pagination.limit, pagination.offset];
    const result = await pool.query(`SELECT ${SITE_VISIT_COLUMNS}, p.project_name, c.first_name, c.last_name, c.email, c.phone_number, u.first_name AS assignee_first_name, u.last_name AS assignee_last_name FROM appointments ap JOIN site_visits sv ON sv.visit_id=ap.appointment_id JOIN projects p ON p.project_id=ap.project_id LEFT JOIN contacts c ON c.contact_id=ap.contact_id LEFT JOIN users u ON u.user_id=ap.assigned_to_user_id ${where} ORDER BY ap.starts_at, ap.appointment_id LIMIT $${listValues.length - 1} OFFSET $${listValues.length}`, listValues);
    const total = Number(count.rows[0]?.total ?? 0); return NextResponse.json({ site_visits: result.rows, pagination: { page: pagination.page, limit: pagination.limit, total, totalPages: Math.ceil(total / pagination.limit) } });
  } catch (error) { console.error("Failed to list site visits", error); return NextResponse.json({ error: "Unable to retrieve site visits" }, { status: 500 }); }
}

export async function POST(request: NextRequest) {
  const scope = await requireOperationsContext(request); if (!scope.ok) return scope.response;
  let body: unknown; try { body = await request.json(); } catch { return NextResponse.json({ error: "Request body must contain valid JSON" }, { status: 400 }); }
  const validation = validateSiteVisitPayload(body, false); if (!validation.ok) return NextResponse.json({ error: "Validation failed", details: validation.errors }, { status: 422 });
  const data = validation.data; if (!canAccessProject(scope.context.access, data.project_id!)) return NextResponse.json({ error: "You do not have access to this project" }, { status: 403 });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await validateActivityReferences(client, scope.context.access.company.company_id, data);
    if (data.assigned_to_user_id) {
      const conflict = await client.query(`SELECT appointment_id FROM appointments WHERE assigned_to_user_id=$1 AND status NOT IN ('cancelled','completed','no_show') AND tstzrange(starts_at,ends_at,'[)') && tstzrange($2::timestamptz,$3::timestamptz,'[)') LIMIT 1`, [data.assigned_to_user_id, data.starts_at, data.ends_at]);
      if (conflict.rowCount) { await client.query("ROLLBACK"); return NextResponse.json({ error: "The assigned user already has an appointment during this time", conflicting_appointment_id: conflict.rows[0].appointment_id }, { status: 409 }); }
    }
    const result = await client.query(
      `INSERT INTO appointments (company_id, project_id, lead_id, opportunity_id, contact_id, appointment_type,
       title, description, location, meeting_url, starts_at, ends_at, timezone, organizer_user_id,
       assigned_to_user_id, assigned_to_team_id, created_by, updated_by)
       VALUES ($1,$2,COALESCE($3,(SELECT lead_id FROM opportunities WHERE opportunity_id=$4)),$4,
       COALESCE($5,(SELECT contact_id FROM opportunities WHERE opportunity_id=$4),(SELECT contact_id FROM leads WHERE lead_id=$3)),
       'site_visit',$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$16) RETURNING *`,
      [scope.context.access.company.company_id, data.project_id, data.lead_id ?? null, data.opportunity_id ?? null, data.contact_id ?? null, data.title, data.description ?? null, data.location ?? null, data.meeting_url ?? null, data.starts_at, data.ends_at, data.timezone ?? "Asia/Kolkata", data.organizer_user_id ?? scope.context.userId, data.assigned_to_user_id ?? null, data.assigned_to_team_id ?? null, scope.context.userId],
    );
    const appointment = result.rows[0];
    await client.query(`INSERT INTO site_visits (visit_id, arrival_instructions, transport_notes, attendee_count) VALUES ($1,$2,$3,$4)`, [appointment.appointment_id, data.arrival_instructions ?? null, data.transport_notes ?? null, data.attendee_count ?? null]);
    await client.query(`INSERT INTO site_visit_participants (visit_id, participant_type, user_id, participant_role, attendance_status) VALUES ($1,'user',$2,'organizer','confirmed') ON CONFLICT DO NOTHING`, [appointment.appointment_id, appointment.organizer_user_id]);
    if (appointment.contact_id) await client.query(`INSERT INTO site_visit_participants (visit_id, participant_type, contact_id, participant_role) VALUES ($1,'contact',$2,'attendee') ON CONFLICT DO NOTHING`, [appointment.appointment_id, appointment.contact_id]);
    await addSiteVisitHistory(client, appointment.appointment_id, "create", null, "scheduled", scope.context.userId);
    await advanceLeadForSiteVisit(client, appointment.lead_id, Number(appointment.project_id), "site_visit_scheduled", scope.context.userId);
    await recordActivity(client, appointment, "appointment", "site_visit_scheduled", `Site visit scheduled: ${appointment.title}`, scope.context.userId, { metadata: { starts_at: appointment.starts_at, ends_at: appointment.ends_at, location: appointment.location } });
    await client.query("COMMIT"); return NextResponse.json({ message: "Site visit created", site_visit: { ...appointment, visit_id: appointment.appointment_id, arrival_instructions: data.arrival_instructions ?? null, transport_notes: data.transport_notes ?? null, attendee_count: data.attendee_count ?? null } }, { status: 201 });
  } catch (error) { await client.query("ROLLBACK").catch(() => undefined); if (error instanceof ActivityReferenceError) return NextResponse.json({ error: error.message }, { status: 422 }); console.error("Failed to create site visit", error); return NextResponse.json({ error: "Unable to create site visit" }, { status: 500 }); }
  finally { client.release(); }
}
