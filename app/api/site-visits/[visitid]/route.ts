import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { ActivityReferenceError, recordActivity, validateActivityReferences } from "@/lib/activities";
import { canAccessOperationsEntity, requireOperationsContext } from "@/lib/operationsAccess";
import { TERMINAL_SITE_VISIT_STATUSES, getSiteVisit, parseVisitUuid, validateSiteVisitPayload } from "@/lib/siteVisits";

type Context = { params: Promise<{ visitid: string }> };
export async function GET(request: NextRequest, context: Context) {
  const scope = await requireOperationsContext(request); if (!scope.ok) return scope.response;
  const visitId = parseVisitUuid((await context.params).visitid); if (!visitId) return NextResponse.json({ error: "visitId must be a valid UUID" }, { status: 400 });
  try {
    const visit = await getSiteVisit(pool, visitId); if (!visit) return NextResponse.json({ error: "Site visit not found" }, { status: 404 });
    if (!canAccessOperationsEntity(scope.context.access, Number(visit.company_id), Number(visit.project_id))) return NextResponse.json({ error: "You do not have access to this site visit" }, { status: 403 });
    const [history, counts, linked] = await Promise.all([
      pool.query("SELECT * FROM site_visit_state_history WHERE visit_id=$1 ORDER BY created_at,history_id", [visitId]),
      pool.query(`SELECT (SELECT COUNT(*) FROM site_visit_participants WHERE visit_id=$1)::integer AS participant_count, (SELECT COUNT(*) FROM site_visit_units_shown WHERE visit_id=$1)::integer AS units_shown_count`, [visitId]),
      pool.query(`SELECT p.project_name, p.project_code, c.first_name, c.last_name, c.email, c.phone_number,
        o.opportunity_name, assignee.first_name AS assignee_first_name, assignee.last_name AS assignee_last_name,
        organizer.first_name AS organizer_first_name, organizer.last_name AS organizer_last_name,
        team.name AS assigned_team_name
        FROM appointments ap JOIN projects p ON p.project_id=ap.project_id
        LEFT JOIN contacts c ON c.contact_id=ap.contact_id LEFT JOIN opportunities o ON o.opportunity_id=ap.opportunity_id
        LEFT JOIN users assignee ON assignee.user_id=ap.assigned_to_user_id
        LEFT JOIN users organizer ON organizer.user_id=ap.organizer_user_id
        LEFT JOIN teams team ON team.team_id=ap.assigned_to_team_id WHERE ap.appointment_id=$1`, [visitId]),
    ]);
    return NextResponse.json({ site_visit: { ...visit, ...linked.rows[0], ...counts.rows[0] }, history: history.rows });
  } catch (error) { console.error("Failed to retrieve site visit", error); return NextResponse.json({ error: "Unable to retrieve site visit" }, { status: 500 }); }
}

export async function PATCH(request: NextRequest, context: Context) {
  const scope = await requireOperationsContext(request); if (!scope.ok) return scope.response;
  const visitId = parseVisitUuid((await context.params).visitid); if (!visitId) return NextResponse.json({ error: "visitId must be a valid UUID" }, { status: 400 });
  let body: unknown; try { body = await request.json(); } catch { return NextResponse.json({ error: "Request body must contain valid JSON" }, { status: 400 }); }
  const validation = validateSiteVisitPayload(body, true); if (!validation.ok) return NextResponse.json({ error: "Validation failed", details: validation.errors }, { status: 422 });
  const immutable = ["project_id", "lead_id", "opportunity_id", "contact_id", "starts_at", "ends_at"].filter((key) => validation.data[key as keyof typeof validation.data] !== undefined);
  if (immutable.length) return NextResponse.json({ error: `Use the reschedule operation for time changes; these fields cannot be patched: ${immutable.join(", ")}` }, { status: 422 });
  const client = await pool.connect();
  try {
    await client.query("BEGIN"); const current = await getSiteVisit(client, visitId, true);
    if (!current) { await client.query("ROLLBACK"); return NextResponse.json({ error: "Site visit not found" }, { status: 404 }); }
    if (!canAccessOperationsEntity(scope.context.access, Number(current.company_id), Number(current.project_id))) { await client.query("ROLLBACK"); return NextResponse.json({ error: "You do not have access to this site visit" }, { status: 403 }); }
    if (TERMINAL_SITE_VISIT_STATUSES.has(String(current.status))) { await client.query("ROLLBACK"); return NextResponse.json({ error: "Completed, cancelled, or no-show site visits cannot be edited" }, { status: 409 }); }
    await validateActivityReferences(client, Number(current.company_id), { project_id: Number(current.project_id), lead_id: current.lead_id as string | null, opportunity_id: current.opportunity_id as string | null, contact_id: current.contact_id as string | null, organizer_user_id: validation.data.organizer_user_id ?? current.organizer_user_id as string | null, assigned_to_user_id: validation.data.assigned_to_user_id !== undefined ? validation.data.assigned_to_user_id : current.assigned_to_user_id as string | null, assigned_to_team_id: validation.data.assigned_to_team_id !== undefined ? validation.data.assigned_to_team_id : current.assigned_to_team_id as string | null });
    const appointmentFields = ["title", "description", "location", "meeting_url", "timezone", "organizer_user_id", "assigned_to_user_id", "assigned_to_team_id"] as const;
    const appointmentEntries = appointmentFields.filter((field) => validation.data[field] !== undefined).map((field) => [field, validation.data[field]] as const);
    let appointment = current;
    if (appointmentEntries.length) { const values = appointmentEntries.map(([, value]) => value); values.push(scope.context.userId, visitId); const result = await client.query(`UPDATE appointments SET ${appointmentEntries.map(([field], index) => `${field}=$${index + 1}`).join(", ")}, updated_by=$${values.length - 1}, updated_at=CURRENT_TIMESTAMP WHERE appointment_id=$${values.length} RETURNING *`, values); appointment = { ...current, ...result.rows[0] }; }
    const visitFields = ["arrival_instructions", "transport_notes", "attendee_count"] as const; const visitEntries = visitFields.filter((field) => validation.data[field] !== undefined).map((field) => [field, validation.data[field]] as const);
    if (visitEntries.length) { const values = visitEntries.map(([, value]) => value); values.push(visitId); await client.query(`UPDATE site_visits SET ${visitEntries.map(([field], index) => `${field}=$${index + 1}`).join(", ")}, updated_at=CURRENT_TIMESTAMP WHERE visit_id=$${values.length}`, values); }
    const fields = [...appointmentEntries.map(([field]) => field), ...visitEntries.map(([field]) => field)];
    await recordActivity(client, appointment, "appointment", "site_visit_updated", `Site visit updated: ${appointment.title}`, scope.context.userId, { metadata: { fields } });
    await client.query("COMMIT"); return NextResponse.json({ message: "Site visit updated", site_visit: await getSiteVisit(pool, visitId) });
  } catch (error) { await client.query("ROLLBACK").catch(() => undefined); if (error instanceof ActivityReferenceError) return NextResponse.json({ error: error.message }, { status: 422 }); console.error("Failed to update site visit", error); return NextResponse.json({ error: "Unable to update site visit" }, { status: 500 }); }
  finally { client.release(); }
}
