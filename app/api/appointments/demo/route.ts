import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { recordActivity } from "@/lib/activities";
import { requireOperationsContext } from "@/lib/operationsAccess";
import { canAccessProject } from "@/lib/projectAccess";

const ADMIN_ROLES = new Set(["COMPANY_OWNER", "COMPANY_ADMIN", "SUPER_ADMIN"]);

const TITLES = {
  call: [
    "Qualification call",
    "Budget follow-up",
    "Decision-maker check-in",
    "Booking confirmation call",
  ],
  meeting: [
    "Project discovery meeting",
    "Pricing consultation",
    "Floor plan review",
    "Booking document review",
  ],
  site_visit: [
    "Tower walkthrough",
    "Sample flat site visit",
    "Amenities tour",
    "Construction progress visit",
  ],
  video: [
    "Virtual property tour",
    "Online payment walkthrough",
    "Remote family consultation",
    "Video project briefing",
  ],
  other: [
    "Document collection",
    "Home loan consultation",
    "Registration preparation",
    "Handover planning",
  ],
} as const;

export async function POST(request: NextRequest) {
  const scope = await requireOperationsContext(request);
  if (!scope.ok) return scope.response;
  if (!ADMIN_ROLES.has(scope.context.access.roleKey)) {
    return NextResponse.json(
      { error: "Only company administrators can generate demo appointments" },
      { status: 403 },
    );
  }

  let body: { project_id?: unknown; count?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json(
      { error: "Request body must contain valid JSON" },
      { status: 400 },
    );
  }
  const projectId = Number(body.project_id);
  const count = body.count === undefined ? 60 : Number(body.count);
  if (!Number.isSafeInteger(projectId) || projectId <= 0) {
    return NextResponse.json(
      { error: "project_id must be a positive integer" },
      { status: 400 },
    );
  }
  if (!Number.isSafeInteger(count) || count < 30 || count > 100) {
    return NextResponse.json(
      { error: "count must be an integer between 30 and 100" },
      { status: 400 },
    );
  }
  if (!canAccessProject(scope.context.access, projectId)) {
    return NextResponse.json(
      { error: "You do not have access to this project" },
      { status: 403 },
    );
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const leads = await client.query(
      `SELECT l.lead_id, l.contact_id, c.first_name, c.last_name
       FROM leads l
       JOIN contacts c ON c.contact_id=l.contact_id
       WHERE l.project_id=$1
       ORDER BY l.updated_at DESC, l.lead_id
       LIMIT 100`,
      [projectId],
    );
    if (!leads.rowCount) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: "Create at least one lead before generating demo appointments" },
        { status: 409 },
      );
    }

    const now = new Date();
    const startToday = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
    );
    const types = ["call", "meeting", "site_visit", "video", "other"] as const;
    let created = 0;

    for (let index = 0; index < count; index += 1) {
      const lead = leads.rows[index % leads.rows.length];
      const type = types[index % types.length];
      const dayOffset = (index * 7) % 50 - 12;
      const hour = 8 + ((index * 3) % 11);
      const minute = index % 3 === 0 ? 30 : 0;
      const startsAt = new Date(startToday);
      startsAt.setDate(startsAt.getDate() + dayOffset);
      startsAt.setHours(hour, minute, 0, 0);
      const durations = [30, 45, 60, 90];
      const duration = durations[index % durations.length];
      const endsAt = new Date(startsAt.getTime() + duration * 60_000);
      const isPast = endsAt.getTime() < now.getTime();
      const status = isPast
        ? index % 5 === 0
          ? "scheduled"
          : index % 7 === 0
            ? "cancelled"
            : "completed"
        : index % 4 === 0
          ? "confirmed"
          : index % 6 === 0
            ? "rescheduled"
            : "scheduled";
      const person =
        [lead.first_name, lead.last_name].filter(Boolean).join(" ") || "Lead";
      const titleOptions = TITLES[type];
      const title = titleOptions[Math.floor(index / types.length) % titleOptions.length];
      const location =
        type === "site_visit"
          ? "CRM Demo Project · Site office"
          : type === "video"
            ? "Online"
            : type === "call"
              ? "Phone"
              : index % 2 === 0
                ? "Sales lounge"
                : "CRM Demo Project";
      const result = await client.query(
        `INSERT INTO appointments (
           company_id, project_id, lead_id, contact_id, appointment_type,
           title, description, location, meeting_url, starts_at, ends_at,
           timezone, status, organizer_user_id, assigned_to_user_id,
           created_by, updated_by, confirmed_at, confirmed_by, completed_at,
           completed_by, cancelled_at, cancelled_by, cancellation_reason,
           reschedule_reason
         ) VALUES (
           $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'Asia/Kolkata',$12,$13,$13,
           $13,$13,
           CASE WHEN $12='confirmed' THEN CURRENT_TIMESTAMP ELSE NULL END,
           CASE WHEN $12='confirmed' THEN $13::uuid ELSE NULL END,
           CASE WHEN $12='completed' THEN $11::timestamptz ELSE NULL END,
           CASE WHEN $12='completed' THEN $13::uuid ELSE NULL END,
           CASE WHEN $12='cancelled' THEN CURRENT_TIMESTAMP ELSE NULL END,
           CASE WHEN $12='cancelled' THEN $13::uuid ELSE NULL END,
           CASE WHEN $12='cancelled' THEN 'Lead requested a different follow-up path' ELSE NULL END,
           CASE WHEN $12='rescheduled' THEN 'Adjusted to match lead availability' ELSE NULL END
         ) RETURNING *`,
        [
          scope.context.access.company.company_id,
          projectId,
          lead.lead_id,
          lead.contact_id,
          type,
          title,
          `${title} with ${person}. Review the latest requirements and record the next action.`,
          location,
          type === "video" ? `https://meet.google.com/sthyra-${String(index + 1).padStart(3, "0")}` : null,
          startsAt,
          endsAt,
          status,
          scope.context.userId,
        ],
      );
      const appointment = result.rows[0];
      await recordActivity(
        client,
        appointment,
        "appointment",
        status === "completed"
          ? "appointment_completed"
          : status === "cancelled"
            ? "appointment_cancelled"
            : "appointment_created",
        `Appointment ${status === "completed" ? "completed" : "scheduled"}: ${title}`,
        scope.context.userId,
        {
          description: appointment.description,
          metadata: {
            appointment_type: type,
            starts_at: startsAt,
            ends_at: endsAt,
            status,
            demo_seed: "calendar-showcase-v1",
          },
          occurredAt: new Date(Math.min(startsAt.getTime() - 2 * 60 * 60_000, now.getTime())),
        },
      );
      created += 1;
    }

    await client.query("COMMIT");
    return NextResponse.json(
      { message: `${created} demo appointments created`, created },
      { status: 201 },
    );
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    console.error("Failed to create demo appointments", error);
    return NextResponse.json(
      { error: "Unable to create demo appointments" },
      { status: 500 },
    );
  } finally {
    client.release();
  }
}
