import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { recordActivity } from "@/lib/activities";
import { requireOperationsContext } from "@/lib/operationsAccess";
import { canAccessProject } from "@/lib/projectAccess";

const DEMO_SEED = "activity-showcase-v1";
const ADMIN_ROLES = new Set(["COMPANY_OWNER", "COMPANY_ADMIN", "SUPER_ADMIN"]);

const callSubjects = [
  "Initial qualification call",
  "Budget discussion",
  "Site visit follow-up",
  "Decision-maker check-in",
  "Booking confirmation",
];
const emailSubjects = [
  "Welcome to Sthyra CRM",
  "Project brochure and floor plans",
  "Your scheduled site visit",
  "Pricing discussion follow-up",
  "Booking documents requested",
];
const taskTitles = [
  "Share updated cost sheet",
  "Confirm site visit attendees",
  "Review qualification details",
  "Prepare booking paperwork",
  "Schedule sales follow-up",
];
const noteTitles = [
  "Lead preference update",
  "Conversation summary",
  "Budget requirements",
  "Family decision timeline",
  "Site visit feedback",
];
const appointmentTitles = [
  "Project discovery meeting",
  "Site visit",
  "Virtual property tour",
  "Pricing consultation",
  "Booking review",
];

export async function POST(request: NextRequest) {
  const scope = await requireOperationsContext(request);
  if (!scope.ok) return scope.response;
  if (!ADMIN_ROLES.has(scope.context.access.roleKey)) {
    return NextResponse.json(
      { error: "Only company administrators can generate demo activity" },
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
  const count = body.count === undefined ? 80 : Number(body.count);
  if (!Number.isSafeInteger(projectId) || projectId <= 0) {
    return NextResponse.json(
      { error: "project_id must be a positive integer" },
      { status: 400 },
    );
  }
  if (!Number.isSafeInteger(count) || count < 50 || count > 100) {
    return NextResponse.json(
      { error: "count must be an integer between 50 and 100" },
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
    const existing = await client.query(
      `SELECT COUNT(*)::integer AS total
       FROM activities
       WHERE project_id=$1 AND actor_user_id=$2
         AND metadata->>'demo_seed'=$3`,
      [projectId, scope.context.userId, DEMO_SEED],
    );
    const existingTotal = Number(existing.rows[0]?.total ?? 0);
    if (existingTotal > 0) {
      await client.query("COMMIT");
      return NextResponse.json({
        message: "Demo activity already exists",
        created: 0,
        existing: existingTotal,
      });
    }

    const leads = await client.query(
      `SELECT l.lead_id, l.contact_id, c.first_name, c.last_name,
        c.email, c.phone_number
       FROM leads l
       JOIN contacts c ON c.contact_id=l.contact_id
       WHERE l.project_id=$1
       ORDER BY l.created_at DESC, l.lead_id
       LIMIT 100`,
      [projectId],
    );
    if (!leads.rowCount) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: "Create at least one lead before generating demo activity" },
        { status: 409 },
      );
    }

    const now = Date.now();
    const created = { calls: 0, emails: 0, tasks: 0, notes: 0, appointments: 0 };
    for (let index = 0; index < count; index += 1) {
      const lead = leads.rows[index % leads.rows.length];
      const occurredAt = new Date(
        now - ((index * 9 + Math.floor(index / 5) * 7) % 648) * 60 * 60 * 1000,
      );
      const category = index % 5;
      const variant = Math.floor(index / 5);
      const person = [lead.first_name, lead.last_name].filter(Boolean).join(" ") || "Lead";
      const baseMetadata = {
        demo_seed: DEMO_SEED,
        sequence: index + 1,
        lead_name: person,
      };

      if (category === 0) {
        const startedAt = occurredAt;
        const duration = 75 + (variant % 9) * 47;
        const endedAt = new Date(startedAt.getTime() + duration * 1000);
        const direction = variant % 3 === 0 ? "inbound" : "outbound";
        const statuses = ["completed", "answered", "missed"];
        const outcomes = ["interested", "follow_up", "no_answer", "voicemail"];
        const result = await client.query(
          `INSERT INTO calls (
             company_id, project_id, lead_id, contact_id, direction, status,
             outcome, phone_number, subject, summary, started_at, ended_at,
             duration_seconds, owner_user_id, created_by, created_at, updated_at
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$14,$11,$11)
           RETURNING *`,
          [
            scope.context.access.company.company_id,
            projectId,
            lead.lead_id,
            lead.contact_id,
            direction,
            statuses[variant % statuses.length],
            outcomes[variant % outcomes.length],
            lead.phone_number || "+91 90000 00000",
            callSubjects[variant % callSubjects.length],
            `Spoke with ${person} about their requirements and agreed on the next follow-up.`,
            startedAt,
            endedAt,
            duration,
            scope.context.userId,
          ],
        );
        const call = result.rows[0];
        await recordActivity(
          client,
          call,
          "call",
          "call_logged",
          `${direction === "inbound" ? "Inbound" : "Outbound"} call with ${person}`,
          scope.context.userId,
          {
            description: call.summary,
            metadata: {
              ...baseMetadata,
              direction,
              status: call.status,
              outcome: call.outcome,
              duration_seconds: duration,
            },
            occurredAt,
          },
        );
        created.calls += 1;
      } else if (category === 1) {
        const inbound = variant % 4 === 0;
        const statuses = ["sent", "delivered", "opened", "replied"];
        const subject = emailSubjects[variant % emailSubjects.length];
        const bodyText = `Hi ${lead.first_name || "there"}, here is the requested update for ${subject.toLowerCase()}. Please reply with a convenient time if you would like to discuss the next step.`;
        const result = await client.query(
          `INSERT INTO emails (
             company_id, project_id, lead_id, contact_id, direction, status,
             subject, body, from_address, to_addresses, sent_at, received_at,
             owner_user_id, created_by, created_at, updated_at
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$13,$14,$14)
           RETURNING *`,
          [
            scope.context.access.company.company_id,
            projectId,
            lead.lead_id,
            lead.contact_id,
            inbound ? "inbound" : "outbound",
            inbound ? "replied" : statuses[variant % statuses.length],
            subject,
            bodyText,
            inbound ? lead.email || "lead@example.com" : "sales@sthyra.com",
            [inbound ? "sales@sthyra.com" : lead.email || "lead@example.com"],
            inbound ? null : occurredAt,
            inbound ? occurredAt : null,
            scope.context.userId,
            occurredAt,
          ],
        );
        const email = result.rows[0];
        await recordActivity(
          client,
          email,
          "email",
          inbound ? "email_received" : "email_sent",
          subject,
          scope.context.userId,
          {
            description: bodyText,
            metadata: {
              ...baseMetadata,
              direction: email.direction,
              status: email.status,
              from_address: email.from_address,
              to_addresses: email.to_addresses,
            },
            occurredAt,
          },
        );
        created.emails += 1;
      } else if (category === 2) {
        const statuses = ["open", "in_progress", "completed"];
        const priorities = ["normal", "high", "urgent", "low"];
        const status = statuses[variant % statuses.length];
        const result = await client.query(
          `INSERT INTO tasks (
             company_id, project_id, lead_id, contact_id, title, description,
             priority, status, due_at, assigned_to_user_id, created_by,
             updated_by, completed_at, completed_by, created_at, updated_at
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::varchar,$9,$10,$10,$10,
             CASE WHEN $8::varchar='completed' THEN $11::timestamptz ELSE NULL END,
             CASE WHEN $8::varchar='completed' THEN $10::uuid ELSE NULL END,$11,$11)
           RETURNING *`,
          [
            scope.context.access.company.company_id,
            projectId,
            lead.lead_id,
            lead.contact_id,
            taskTitles[variant % taskTitles.length],
            `Complete this follow-up for ${person} and record the outcome.`,
            priorities[variant % priorities.length],
            status,
            new Date(occurredAt.getTime() + 36 * 60 * 60 * 1000),
            scope.context.userId,
            occurredAt,
          ],
        );
        const task = result.rows[0];
        await recordActivity(
          client,
          task,
          "task",
          status === "completed" ? "task_completed" : "task_created",
          `${status === "completed" ? "Task completed" : "Task created"}: ${task.title}`,
          scope.context.userId,
          {
            description: task.description,
            metadata: { ...baseMetadata, status, priority: task.priority },
            occurredAt,
          },
        );
        created.tasks += 1;
      } else if (category === 3) {
        const title = noteTitles[variant % noteTitles.length];
        const noteBody = `${person} prefers a structured follow-up and requested that the sales team keep the latest project options, budget, and timing in view.`;
        const result = await client.query(
          `INSERT INTO notes (
             company_id, project_id, lead_id, contact_id, title, body,
             visibility, is_pinned, created_by, updated_by, created_at, updated_at
           ) VALUES ($1,$2,$3,$4,$5,$6,'company',$7,$8,$8,$9,$9)
           RETURNING *`,
          [
            scope.context.access.company.company_id,
            projectId,
            lead.lead_id,
            lead.contact_id,
            title,
            noteBody,
            variant % 6 === 0,
            scope.context.userId,
            occurredAt,
          ],
        );
        const note = result.rows[0];
        await recordActivity(
          client,
          note,
          "note",
          "note_created",
          title,
          scope.context.userId,
          {
            description: noteBody,
            metadata: { ...baseMetadata, visibility: "company", is_pinned: note.is_pinned },
            occurredAt,
          },
        );
        created.notes += 1;
      } else {
        const startsAt = new Date(occurredAt.getTime() + (variant % 5 + 1) * 24 * 60 * 60 * 1000);
        const endsAt = new Date(startsAt.getTime() + 60 * 60 * 1000);
        const types = ["meeting", "site_visit", "video", "other"];
        const statuses = ["scheduled", "confirmed", "rescheduled", "completed"];
        const result = await client.query(
          `INSERT INTO appointments (
             company_id, project_id, lead_id, contact_id, appointment_type,
             title, description, location, starts_at, ends_at, timezone,
             status, organizer_user_id, assigned_to_user_id, created_by,
             updated_by, created_at, updated_at
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'Asia/Kolkata',$11,$12,$12,$12,$12,$13,$13)
           RETURNING *`,
          [
            scope.context.access.company.company_id,
            projectId,
            lead.lead_id,
            lead.contact_id,
            types[variant % types.length],
            appointmentTitles[variant % appointmentTitles.length],
            `Appointment with ${person} to move the opportunity forward.`,
            variant % 2 === 0 ? "CRM Demo Project sales office" : "Online",
            startsAt,
            endsAt,
            statuses[variant % statuses.length],
            scope.context.userId,
            occurredAt,
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
            description: appointment.description,
            metadata: {
              ...baseMetadata,
              appointment_type: appointment.appointment_type,
              starts_at: appointment.starts_at,
              ends_at: appointment.ends_at,
              status: appointment.status,
            },
            occurredAt,
          },
        );
        created.appointments += 1;
      }
    }

    await client.query("COMMIT");
    return NextResponse.json(
      {
        message: `${count} demo activities created`,
        created: count,
        breakdown: created,
      },
      { status: 201 },
    );
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    console.error("Failed to create demo activity", error);
    return NextResponse.json(
      { error: "Unable to create demo activity" },
      { status: 500 },
    );
  } finally {
    client.release();
  }
}
