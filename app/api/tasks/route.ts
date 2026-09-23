import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import {
  ActivityReferenceError,
  parseActivityUuid,
  recordActivity,
  TASK_COLUMNS,
  validateActivityReferences,
  validateTaskPayload,
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
  const filters = ["t.project_id=ANY($1::integer[])"];
  const projectValue = request.nextUrl.searchParams.get("project_id");
  if (projectValue) {
    const projectId = parsePositiveInteger(projectValue);
    if (!projectId || !canAccessProject(scope.context.access, projectId))
      return NextResponse.json(
        { error: "Invalid or inaccessible project_id" },
        { status: 400 },
      );
    values.push(projectId);
    filters.push(`t.project_id=$${values.length}`);
  }
  const status = request.nextUrl.searchParams.get("status");
  if (status) {
    if (!["open", "in_progress", "completed", "cancelled"].includes(status))
      return NextResponse.json(
        { error: "Invalid task status" },
        { status: 400 },
      );
    values.push(status);
    filters.push(`t.status=$${values.length}`);
  }
  const priority = request.nextUrl.searchParams.get("priority");
  if (priority) {
    if (!["low", "normal", "high", "urgent"].includes(priority))
      return NextResponse.json(
        { error: "Invalid task priority" },
        { status: 400 },
      );
    values.push(priority);
    filters.push(`t.priority=$${values.length}`);
  }
  for (const field of [
    "lead_id",
    "contact_id",
    "assigned_to_user_id",
    "assigned_to_team_id",
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
    filters.push(`t.${field}=$${values.length}`);
  }
  if (request.nextUrl.searchParams.get("overdue") === "true")
    filters.push(
      "t.status IN ('open','in_progress') AND t.due_at < CURRENT_TIMESTAMP",
    );
  const search = request.nextUrl.searchParams.get("search")?.trim();
  if (search) {
    values.push(`%${search}%`);
    filters.push(
      `(t.title ILIKE $${values.length} OR t.description ILIKE $${values.length})`,
    );
  }
  const where = `WHERE ${filters.join(" AND ")}`;
  try {
    const count = await pool.query(
      `SELECT COUNT(*)::integer AS total FROM tasks t ${where}`,
      values,
    );
    const listValues = [...values, pagination.limit, pagination.offset];
    const result = await pool.query(
      `SELECT ${TASK_COLUMNS}, p.project_name, c.first_name, c.last_name,
        u.first_name AS assignee_first_name, u.last_name AS assignee_last_name,
        team.name AS assigned_team_name
       FROM tasks t JOIN projects p ON p.project_id=t.project_id
       LEFT JOIN contacts c ON c.contact_id=t.contact_id
       LEFT JOIN users u ON u.user_id=t.assigned_to_user_id
       LEFT JOIN teams team ON team.team_id=t.assigned_to_team_id
       ${where}
       ORDER BY CASE t.priority WHEN 'urgent' THEN 1 WHEN 'high' THEN 2 WHEN 'normal' THEN 3 ELSE 4 END,
         t.due_at NULLS LAST, t.created_at DESC
       LIMIT $${listValues.length - 1} OFFSET $${listValues.length}`,
      listValues,
    );
    const total = Number(count.rows[0]?.total ?? 0);
    return NextResponse.json({
      tasks: result.rows,
      pagination: {
        page: pagination.page,
        limit: pagination.limit,
        total,
        totalPages: Math.ceil(total / pagination.limit),
      },
    });
  } catch (error) {
    console.error("Failed to list tasks", error);
    return NextResponse.json(
      { error: "Unable to retrieve tasks" },
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
  const validation = validateTaskPayload(body, false);
  if (!validation.ok)
    return NextResponse.json(
      { error: "Validation failed", details: validation.errors },
      { status: 422 },
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
      `INSERT INTO tasks (company_id, project_id, lead_id, contact_id, title,
        description, priority, status, due_at, assigned_to_user_id,
        assigned_to_team_id, created_by, updated_by)
       VALUES ($1,$2,$3,COALESCE($4,(SELECT contact_id FROM leads WHERE lead_id=$3)),
        $5,$6,$7,$8,$9,$10,$11,$12,$12) RETURNING *`,
      [
        scope.context.access.company.company_id,
        validation.data.project_id,
        validation.data.lead_id ?? null,
        validation.data.contact_id ?? null,
        validation.data.title,
        validation.data.description ?? null,
        validation.data.priority ?? "normal",
        validation.data.status ?? "open",
        validation.data.due_at ?? null,
        validation.data.assigned_to_user_id ?? null,
        validation.data.assigned_to_team_id ?? null,
        scope.context.userId,
      ],
    );
    const task = result.rows[0];
    await recordActivity(
      client,
      task,
      "task",
      "task_created",
      `Task created: ${task.title}`,
      scope.context.userId,
      { metadata: { status: task.status, priority: task.priority } },
    );
    await client.query("COMMIT");
    return NextResponse.json(
      { message: "Task created", task },
      { status: 201 },
    );
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    if (error instanceof ActivityReferenceError)
      return NextResponse.json({ error: error.message }, { status: 422 });
    console.error("Failed to create task", error);
    return NextResponse.json(
      { error: "Unable to create task" },
      { status: 500 },
    );
  } finally {
    client.release();
  }
}
