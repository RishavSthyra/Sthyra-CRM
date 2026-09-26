import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { canAccessOperationsEntity, requireOperationsContext } from "@/lib/operationsAccess";
import { TERMINAL_SITE_VISIT_STATUSES, getSiteVisit, parseVisitUuid, validateParticipants } from "@/lib/siteVisits";

type Context = { params: Promise<{ visitid: string }> };
async function accessVisit(request: NextRequest, rawId: string) {
  const scope = await requireOperationsContext(request); if (!scope.ok) return scope;
  const visitId = parseVisitUuid(rawId); if (!visitId) return { ok: false as const, response: NextResponse.json({ error: "visitId must be a valid UUID" }, { status: 400 }) };
  const visit = await getSiteVisit(pool, visitId); if (!visit) return { ok: false as const, response: NextResponse.json({ error: "Site visit not found" }, { status: 404 }) };
  if (!canAccessOperationsEntity(scope.context.access, Number(visit.company_id), Number(visit.project_id))) return { ok: false as const, response: NextResponse.json({ error: "You do not have access to this site visit" }, { status: 403 }) };
  return { ok: true as const, context: scope.context, visitId, visit };
}

export async function GET(request: NextRequest, context: Context) {
  try {
    const access = await accessVisit(request, (await context.params).visitid); if (!access.ok) return access.response;
    const result = await pool.query(
      `SELECT svp.*, u.first_name AS user_first_name, u.last_name AS user_last_name, u.email AS user_email,
       c.first_name AS contact_first_name, c.last_name AS contact_last_name, c.email AS contact_email, c.phone_number AS contact_phone
       FROM site_visit_participants svp LEFT JOIN users u ON u.user_id=svp.user_id LEFT JOIN contacts c ON c.contact_id=svp.contact_id
       WHERE svp.visit_id=$1 ORDER BY CASE svp.participant_role WHEN 'organizer' THEN 1 WHEN 'host' THEN 2 ELSE 3 END, svp.created_at`, [access.visitId],
    );
    return NextResponse.json({ participants: result.rows });
  } catch (error) { console.error("Failed to retrieve site visit participants", error); return NextResponse.json({ error: "Unable to retrieve site visit participants" }, { status: 500 }); }
}

export async function PUT(request: NextRequest, context: Context) {
  const access = await accessVisit(request, (await context.params).visitid); if (!access.ok) return access.response;
  if (TERMINAL_SITE_VISIT_STATUSES.has(String(access.visit.status))) return NextResponse.json({ error: "Participants cannot be replaced after a site visit is closed" }, { status: 409 });
  let body: unknown; try { body = await request.json(); } catch { return NextResponse.json({ error: "Request body must contain valid JSON" }, { status: 400 }); }
  const validation = validateParticipants(body); if (!validation.ok) return NextResponse.json({ error: "Validation failed", details: validation.errors }, { status: 422 });
  if (!validation.data.some((participant) => participant.participant_type === "user" && ["organizer", "host"].includes(participant.participant_role ?? ""))) return NextResponse.json({ error: "At least one internal organizer or host is required" }, { status: 422 });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const participant of validation.data) {
      if (participant.user_id) { const user = await client.query(`SELECT 1 FROM users u JOIN teams t ON t.team_id=u.team_id WHERE u.user_id=$1 AND t.company_id=$2 AND u.is_active=TRUE AND u.deleted_at IS NULL`, [participant.user_id, access.visit.company_id]); if (!user.rowCount) { await client.query("ROLLBACK"); return NextResponse.json({ error: `User ${participant.user_id} is not an active company user` }, { status: 422 }); } }
      if (participant.contact_id) { const contact = await client.query(`SELECT 1 FROM contacts c WHERE c.contact_id=$1 AND c.archived_at IS NULL AND (c.contact_id=$2 OR EXISTS (SELECT 1 FROM leads l WHERE l.contact_id=c.contact_id AND l.project_id=$3))`, [participant.contact_id, access.visit.contact_id, access.visit.project_id]); if (!contact.rowCount) { await client.query("ROLLBACK"); return NextResponse.json({ error: `Contact ${participant.contact_id} is not linked to this project` }, { status: 422 }); } }
    }
    await client.query("DELETE FROM site_visit_participants WHERE visit_id=$1", [access.visitId]);
    for (const participant of validation.data) await client.query(
      `INSERT INTO site_visit_participants (visit_id,participant_type,user_id,contact_id,external_name,external_email,external_phone,participant_role,attendance_status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [access.visitId, participant.participant_type, participant.user_id ?? null, participant.contact_id ?? null, participant.external_name ?? null, participant.external_email ?? null, participant.external_phone ?? null, participant.participant_role ?? "attendee", participant.attendance_status ?? "expected"],
    );
    await client.query("UPDATE site_visits SET attendee_count=$2, updated_at=CURRENT_TIMESTAMP WHERE visit_id=$1", [access.visitId, validation.data.length]);
    await client.query("COMMIT");
    const result = await pool.query("SELECT * FROM site_visit_participants WHERE visit_id=$1 ORDER BY created_at", [access.visitId]);
    return NextResponse.json({ message: "Site visit participants replaced", participants: result.rows });
  } catch (error) { await client.query("ROLLBACK").catch(() => undefined); console.error("Failed to replace site visit participants", error); return NextResponse.json({ error: "Unable to replace site visit participants" }, { status: 500 }); }
  finally { client.release(); }
}
