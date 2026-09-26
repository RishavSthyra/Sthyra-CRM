import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { ACTIVITY_COLUMNS, parseActivityUuid } from "@/lib/activities";
import {
  canAccessOperationsEntity,
  requireOperationsContext,
} from "@/lib/operationsAccess";
import { getAccessibleProjectIds } from "@/lib/projectAccess";
import { parsePagination } from "@/utils/parsePagination";
import { parsePositiveInteger } from "@/utils/parsePositiveInteger";

export async function listActivities(request: NextRequest, timeline = false) {
  const scope = await requireOperationsContext(request);
  if (!scope.ok) return scope.response;
  const pagination = parsePagination(request.nextUrl.searchParams, 30, 100);
  if (!pagination.ok) {
    return NextResponse.json({ error: pagination.error }, { status: 400 });
  }
  const projectIds = getAccessibleProjectIds(scope.context.access);
  const values: unknown[] = [projectIds, scope.context.userId];
  const filters = [
    "a.project_id=ANY($1::integer[])",
    `(a.source_type <> 'note' OR n.visibility='company' OR n.created_by=$2
      OR (n.visibility='team' AND n.owner_team_id=(SELECT team_id FROM users WHERE user_id=$2)))`,
  ];
  const projectValue = request.nextUrl.searchParams.get("project_id");
  if (projectValue) {
    const projectId = parsePositiveInteger(projectValue);
    if (!projectId || !projectIds.includes(projectId)) {
      return NextResponse.json(
        { error: "Invalid or inaccessible project_id" },
        { status: 400 },
      );
    }
    values.push(projectId);
    filters.push(`a.project_id=$${values.length}`);
  }
  for (const field of ["lead_id", "contact_id", "actor_user_id"] as const) {
    const raw = request.nextUrl.searchParams.get(field);
    if (!raw) continue;
    const id = parseActivityUuid(raw);
    if (!id) {
      return NextResponse.json(
        { error: `${field} must be a valid UUID` },
        { status: 400 },
      );
    }
    values.push(id);
    filters.push(`a.${field}=$${values.length}`);
  }
  const sourceType = request.nextUrl.searchParams.get("source_type");
  if (sourceType) {
    if (!["task", "note", "appointment", "call", "email"].includes(sourceType)) {
      return NextResponse.json(
        { error: "Invalid source_type" },
        { status: 400 },
      );
    }
    values.push(sourceType);
    filters.push(`a.source_type=$${values.length}`);
  }
  const activityType = request.nextUrl.searchParams.get("activity_type");
  if (activityType) {
    values.push(activityType);
    filters.push(`a.activity_type=$${values.length}`);
  }
  for (const [parameter, operator] of [
    ["from", ">="],
    ["to", "<="],
  ] as const) {
    const raw = request.nextUrl.searchParams.get(parameter);
    if (!raw) continue;
    if (Number.isNaN(Date.parse(raw))) {
      return NextResponse.json(
        { error: `${parameter} must be a valid date-time` },
        { status: 400 },
      );
    }
    values.push(new Date(raw).toISOString());
    filters.push(`a.occurred_at ${operator} $${values.length}`);
  }
  const search = request.nextUrl.searchParams.get("search")?.trim();
  if (search) {
    values.push(`%${search}%`);
    filters.push(
      `(a.title ILIKE $${values.length} OR a.description ILIKE $${values.length})`,
    );
  }
  const where = `WHERE ${filters.join(" AND ")}`;
  try {
    const count = await pool.query(
      `SELECT COUNT(*)::integer AS total
       FROM activities a LEFT JOIN notes n ON n.note_id=a.source_id AND a.source_type='note'
       ${where}`,
      values,
    );
    const listValues = [...values, pagination.limit, pagination.offset];
    const result = await pool.query(
      `SELECT ${ACTIVITY_COLUMNS}, p.project_name,
        ap.appointment_type AS source_appointment_type,
        COALESCE(ap.starts_at, cl.started_at, em.sent_at, em.received_at) AS source_starts_at,
        COALESCE(n.body, t.description, ap.description, cl.summary, em.body) AS source_description,
        COALESCE(cl.direction, em.direction) AS source_direction,
        COALESCE(cl.status, em.status) AS source_status,
        cl.outcome AS source_outcome,
        cl.phone_number AS source_phone_number,
        cl.duration_seconds AS source_duration_seconds,
        em.from_address AS source_from_address,
        em.to_addresses AS source_to_addresses,
        c.first_name AS contact_first_name, c.last_name AS contact_last_name,
        u.first_name AS actor_first_name, u.last_name AS actor_last_name
       FROM activities a
       JOIN projects p ON p.project_id=a.project_id
       LEFT JOIN contacts c ON c.contact_id=a.contact_id
       LEFT JOIN users u ON u.user_id=a.actor_user_id
       LEFT JOIN notes n ON n.note_id=a.source_id AND a.source_type='note'
       LEFT JOIN tasks t ON t.task_id=a.source_id AND a.source_type='task'
       LEFT JOIN appointments ap ON ap.appointment_id=a.source_id AND a.source_type='appointment'
       LEFT JOIN calls cl ON cl.call_id=a.source_id AND a.source_type='call'
       LEFT JOIN emails em ON em.email_id=a.source_id AND a.source_type='email'
       ${where}
       ORDER BY a.occurred_at DESC, a.activity_id DESC
       LIMIT $${listValues.length - 1} OFFSET $${listValues.length}`,
      listValues,
    );
    const total = Number(count.rows[0]?.total ?? 0);
    return NextResponse.json({
      [timeline ? "timeline" : "activities"]: result.rows,
      pagination: {
        page: pagination.page,
        limit: pagination.limit,
        total,
        totalPages: Math.ceil(total / pagination.limit),
      },
    });
  } catch (error) {
    console.error("Failed to list activities", error);
    return NextResponse.json(
      { error: "Unable to retrieve activities" },
      { status: 500 },
    );
  }
}

export async function getActivity(request: NextRequest, rawActivityId: string) {
  const scope = await requireOperationsContext(request);
  if (!scope.ok) return scope.response;
  const activityId = parseActivityUuid(rawActivityId);
  if (!activityId) {
    return NextResponse.json(
      { error: "activityId must be a valid UUID" },
      { status: 400 },
    );
  }
  try {
    const result = await pool.query(
      `SELECT ${ACTIVITY_COLUMNS}, p.project_name,
        c.first_name AS contact_first_name, c.last_name AS contact_last_name,
        u.first_name AS actor_first_name, u.last_name AS actor_last_name,
        CASE a.source_type
          WHEN 'task' THEN to_jsonb(t)
          WHEN 'note' THEN to_jsonb(n)
          WHEN 'appointment' THEN to_jsonb(ap)
          WHEN 'call' THEN to_jsonb(cl)
          WHEN 'email' THEN to_jsonb(em)
        END AS source
       FROM activities a
       JOIN projects p ON p.project_id=a.project_id
       LEFT JOIN contacts c ON c.contact_id=a.contact_id
       LEFT JOIN users u ON u.user_id=a.actor_user_id
       LEFT JOIN tasks t ON t.task_id=a.source_id AND a.source_type='task'
       LEFT JOIN notes n ON n.note_id=a.source_id AND a.source_type='note'
       LEFT JOIN appointments ap ON ap.appointment_id=a.source_id AND a.source_type='appointment'
       LEFT JOIN calls cl ON cl.call_id=a.source_id AND a.source_type='call'
       LEFT JOIN emails em ON em.email_id=a.source_id AND a.source_type='email'
       WHERE a.activity_id=$1`,
      [activityId],
    );
    if (!result.rowCount) {
      return NextResponse.json(
        { error: "Activity not found" },
        { status: 404 },
      );
    }
    const activity = result.rows[0];
    if (
      !canAccessOperationsEntity(
        scope.context.access,
        Number(activity.company_id),
        Number(activity.project_id),
      )
    ) {
      return NextResponse.json(
        { error: "You do not have access to this activity" },
        { status: 403 },
      );
    }
    if (activity.source_type === "note") {
      const note = activity.source as Record<string, unknown> | null;
      const allowed = await pool.query(
        `SELECT 1 FROM notes n
         WHERE n.note_id=$1 AND (
           n.visibility='company' OR n.created_by=$2 OR
           (n.visibility='team' AND n.owner_team_id=(SELECT team_id FROM users WHERE user_id=$2))
         )`,
        [activity.source_id, scope.context.userId],
      );
      if (!note || !allowed.rowCount) {
        return NextResponse.json(
          { error: "You do not have access to this activity" },
          { status: 403 },
        );
      }
    }
    return NextResponse.json({ activity });
  } catch (error) {
    console.error("Failed to retrieve activity", error);
    return NextResponse.json(
      { error: "Unable to retrieve activity" },
      { status: 500 },
    );
  }
}
