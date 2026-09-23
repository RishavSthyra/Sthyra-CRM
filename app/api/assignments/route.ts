import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import {
  createAssignment,
  getLeadContext,
  OperationsConflictError,
  OperationsReferenceError,
} from "@/lib/assignmentService";
import {
  ASSIGNMENT_COLUMNS,
  parseUuid,
  validateAssignmentPayload,
} from "@/lib/operations";
import {
  canAccessOperationsEntity,
  requireOperationsContext,
} from "@/lib/operationsAccess";
import { getAccessibleProjectIds } from "@/lib/projectAccess";
import { getDatabaseErrorCode } from "@/utils/getDatabaseErrorCode";
import { parsePagination } from "@/utils/parsePagination";
import { parsePositiveInteger } from "@/utils/parsePositiveInteger";

export async function GET(request: NextRequest) {
  const scope = await requireOperationsContext(request);
  if (!scope.ok) return scope.response;
  const pagination = parsePagination(request.nextUrl.searchParams);
  if (!pagination.ok)
    return NextResponse.json({ error: pagination.error }, { status: 400 });
  const projectIds = getAccessibleProjectIds(scope.context.access);
  const values: unknown[] = [
    scope.context.access.company.company_id,
    projectIds,
  ];
  const filters = ["a.company_id=$1", "a.project_id=ANY($2::integer[])"];
  const projectValue = request.nextUrl.searchParams.get("project_id");
  if (projectValue) {
    const projectId = parsePositiveInteger(projectValue);
    if (!projectId || !projectIds.includes(projectId))
      return NextResponse.json(
        { error: "Invalid or inaccessible project_id" },
        { status: 400 },
      );
    values.push(projectId);
    filters.push(`a.project_id=$${values.length}`);
  }
  const statuses = [
    "pending",
    "accepted",
    "rejected",
    "released",
    "reassigned",
    "cancelled",
    "completed",
  ];
  const status = request.nextUrl.searchParams.get("status");
  if (status) {
    if (!statuses.includes(status))
      return NextResponse.json(
        { error: "Invalid assignment status" },
        { status: 400 },
      );
    values.push(status);
    filters.push(`a.status=$${values.length}`);
  }
  for (const field of ["lead_id", "queue_id", "assigned_to_user_id"] as const) {
    const raw = request.nextUrl.searchParams.get(field);
    if (!raw) continue;
    const id = parseUuid(raw);
    if (!id)
      return NextResponse.json(
        { error: `${field} must be a valid UUID` },
        { status: 400 },
      );
    values.push(id);
    filters.push(`a.${field}=$${values.length}`);
  }
  const where = `WHERE ${filters.join(" AND ")}`;
  try {
    const count = await pool.query(
      `SELECT COUNT(*)::integer AS total FROM assignments a ${where}`,
      values,
    );
    const listValues = [...values, pagination.limit, pagination.offset];
    const result = await pool.query(
      `SELECT ${ASSIGNMENT_COLUMNS},
        c.first_name, c.last_name, c.email, p.project_name,
        q.queue_name, u.first_name AS assignee_first_name, u.last_name AS assignee_last_name,
        t.name AS assigned_team_name
       FROM assignments a
       JOIN leads l ON l.lead_id=a.lead_id
       JOIN contacts c ON c.contact_id=l.contact_id
       JOIN projects p ON p.project_id=a.project_id
       LEFT JOIN queues q ON q.queue_id=a.queue_id
       LEFT JOIN users u ON u.user_id=a.assigned_to_user_id
       LEFT JOIN teams t ON t.team_id=a.assigned_to_team_id
       ${where}
       ORDER BY a.assigned_at DESC, a.assignment_id
       LIMIT $${listValues.length - 1} OFFSET $${listValues.length}`,
      listValues,
    );
    const total = Number(count.rows[0]?.total ?? 0);
    return NextResponse.json({
      assignments: result.rows,
      pagination: {
        page: pagination.page,
        limit: pagination.limit,
        total,
        totalPages: Math.ceil(total / pagination.limit),
      },
    });
  } catch (error) {
    console.error("Failed to list assignments", error);
    return NextResponse.json(
      { error: "Unable to retrieve assignments" },
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
  const validation = validateAssignmentPayload(body);
  if (!validation.ok)
    return NextResponse.json(
      { error: "Validation failed", details: validation.errors },
      { status: 422 },
    );
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const lead = await getLeadContext(client, validation.data.lead_id, false);
    if (!lead) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "Lead not found" }, { status: 404 });
    }
    if (
      !canAccessOperationsEntity(
        scope.context.access,
        Number(lead.company_id),
        Number(lead.project_id),
      )
    ) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: "You do not have access to this lead" },
        { status: 403 },
      );
    }
    const assignment = await createAssignment(
      client,
      {
        leadId: validation.data.lead_id,
        queueId: validation.data.queue_id,
        userId: validation.data.assigned_to_user_id,
        teamId: validation.data.assigned_to_team_id,
        priority: validation.data.priority,
        notes: validation.data.notes,
      },
      scope.context.userId,
    );
    await client.query("COMMIT");
    return NextResponse.json(
      { message: "Assignment created", assignment },
      { status: 201 },
    );
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    if (error instanceof OperationsReferenceError)
      return NextResponse.json({ error: error.message }, { status: 422 });
    if (
      error instanceof OperationsConflictError ||
      getDatabaseErrorCode(error) === "23505"
    )
      return NextResponse.json(
        {
          error:
            error instanceof Error
              ? error.message
              : "Lead already has a current assignment",
        },
        { status: 409 },
      );
    console.error("Failed to create assignment", error);
    return NextResponse.json(
      { error: "Unable to create assignment" },
      { status: 500 },
    );
  } finally {
    client.release();
  }
}
