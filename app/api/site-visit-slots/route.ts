import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { parseVisitUuid } from "@/lib/siteVisits";
import { requireOperationsContext } from "@/lib/operationsAccess";
import { canAccessProject } from "@/lib/projectAccess";
import { parsePositiveInteger } from "@/utils/parsePositiveInteger";

export async function GET(request: NextRequest) {
  const scope = await requireOperationsContext(request); if (!scope.ok) return scope.response;
  const projectId = parsePositiveInteger(request.nextUrl.searchParams.get("project_id") ?? "");
  if (!projectId || !canAccessProject(scope.context.access, projectId)) return NextResponse.json({ error: "Valid, accessible project_id is required" }, { status: 400 });
  const date = request.nextUrl.searchParams.get("date") ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) return NextResponse.json({ error: "date must use YYYY-MM-DD" }, { status: 400 });
  const ownerValue = request.nextUrl.searchParams.get("assigned_to_user_id"); const ownerId = ownerValue ? parseVisitUuid(ownerValue) : null;
  if (ownerValue && !ownerId) return NextResponse.json({ error: "assigned_to_user_id must be a valid UUID" }, { status: 400 });
  const durationValue = request.nextUrl.searchParams.get("duration_minutes"); let duration: number | null = null;
  if (durationValue !== null) { duration = Number(durationValue); if (!Number.isSafeInteger(duration) || duration < 15 || duration > 480) return NextResponse.json({ error: "duration_minutes must be an integer between 15 and 480" }, { status: 400 }); }
  const timezone = request.nextUrl.searchParams.get("timezone") ?? "Asia/Kolkata";
  try { new Intl.DateTimeFormat("en", { timeZone: timezone }); } catch { return NextResponse.json({ error: "timezone must be a valid IANA timezone" }, { status: 400 }); }
  try {
    if (ownerId) {
      const user = await pool.query(`SELECT 1 FROM users u JOIN teams t ON t.team_id=u.team_id WHERE u.user_id=$1 AND t.company_id=$2 AND u.is_active=TRUE AND u.deleted_at IS NULL`, [ownerId, scope.context.access.company.company_id]);
      if (!user.rowCount) return NextResponse.json({ error: "assigned_to_user_id is not an active company user" }, { status: 422 });
    }
    const result = await pool.query(
      `WITH configured AS (
         SELECT starts_at, ends_at, slot_duration_minutes, slot_interval_minutes, capacity, timezone
         FROM site_visit_availability_rules
         WHERE project_id=$1 AND day_of_week=EXTRACT(ISODOW FROM $2::date)::integer AND is_active=TRUE
       ), rules AS (
         SELECT * FROM configured
         UNION ALL
         SELECT TIME '09:00', TIME '18:00', 60, 30, 1, $5::varchar
         WHERE NOT EXISTS (SELECT 1 FROM configured)
       ), slots AS (
         SELECT generated AS slot_start,
                generated + make_interval(mins=>COALESCE($4,r.slot_duration_minutes)) AS slot_end,
                r.capacity, r.timezone
         FROM rules r
         CROSS JOIN LATERAL generate_series(
           ($2::date+r.starts_at) AT TIME ZONE r.timezone,
           (($2::date+r.ends_at) AT TIME ZONE r.timezone)-make_interval(mins=>COALESCE($4,r.slot_duration_minutes)),
           make_interval(mins=>r.slot_interval_minutes)
         ) generated
       )
       SELECT s.slot_start AS starts_at, s.slot_end AS ends_at, s.timezone, s.capacity,
         (SELECT COUNT(*)::integer FROM appointments ap
          WHERE ap.project_id=$1 AND ap.appointment_type='site_visit'
            AND ap.status NOT IN ('cancelled','completed','no_show')
            AND tstzrange(ap.starts_at,ap.ends_at,'[)') && tstzrange(s.slot_start,s.slot_end,'[)')) AS booked_count,
         CASE WHEN $3::uuid IS NULL THEN FALSE ELSE EXISTS (
           SELECT 1 FROM appointments busy WHERE busy.assigned_to_user_id=$3
             AND busy.status NOT IN ('cancelled','completed','no_show')
             AND tstzrange(busy.starts_at,busy.ends_at,'[)') && tstzrange(s.slot_start,s.slot_end,'[)')
         ) END AS owner_busy
       FROM slots s ORDER BY s.slot_start`, [projectId, date, ownerId, duration, timezone],
    );
    const slots = result.rows.map((slot) => ({ ...slot, available: Number(slot.booked_count) < Number(slot.capacity) && !slot.owner_busy }));
    return NextResponse.json({ project_id: projectId, date, assigned_to_user_id: ownerId, slots });
  } catch (error) { console.error("Failed to generate site visit slots", error); return NextResponse.json({ error: "Unable to generate site visit slots" }, { status: 500 }); }
}
