import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { OperationsReferenceError } from "@/lib/assignmentService";
import { QUEUE_COLUMNS, validateQueuePayload } from "@/lib/operations";
import { requireOperationsContext } from "@/lib/operationsAccess";
import {
  replaceQueueMembers,
  validateQueueReferences,
} from "@/lib/queueService";
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
  const filters = [
    "q.company_id=$1",
    "(q.project_id IS NULL OR q.project_id=ANY($2::integer[]))",
  ];
  const projectValue = request.nextUrl.searchParams.get("project_id");
  if (projectValue) {
    const projectId = parsePositiveInteger(projectValue);
    if (!projectId || !projectIds.includes(projectId))
      return NextResponse.json(
        { error: "Invalid or inaccessible project_id" },
        { status: 400 },
      );
    values.push(projectId);
    filters.push(`(q.project_id IS NULL OR q.project_id=$${values.length})`);
  }
  const active = request.nextUrl.searchParams.get("is_active");
  if (active !== null) {
    if (!["true", "false"].includes(active))
      return NextResponse.json(
        { error: "is_active must be true or false" },
        { status: 400 },
      );
    values.push(active === "true");
    filters.push(`q.is_active=$${values.length}`);
  }
  const where = `WHERE ${filters.join(" AND ")}`;
  try {
    const count = await pool.query(
      `SELECT COUNT(*)::integer AS total FROM queues q ${where}`,
      values,
    );
    const listValues = [...values, pagination.limit, pagination.offset];
    const result = await pool.query(
      `SELECT ${QUEUE_COLUMNS}, p.project_name, t.name AS team_name,
        COUNT(DISTINCT qm.user_id)::integer AS member_count,
        COUNT(DISTINCT qr.queue_record_id) FILTER (WHERE qr.status='waiting')::integer AS waiting_count
       FROM queues q
       LEFT JOIN projects p ON p.project_id=q.project_id
       LEFT JOIN teams t ON t.team_id=q.team_id
       LEFT JOIN queue_members qm ON qm.queue_id=q.queue_id AND qm.is_active=TRUE
       LEFT JOIN queue_records qr ON qr.queue_id=q.queue_id
       ${where}
       GROUP BY q.queue_id, p.project_name, t.name
       ORDER BY q.queue_name, q.queue_id
       LIMIT $${listValues.length - 1} OFFSET $${listValues.length}`,
      listValues,
    );
    const total = Number(count.rows[0]?.total ?? 0);
    return NextResponse.json({
      queues: result.rows,
      pagination: {
        page: pagination.page,
        limit: pagination.limit,
        total,
        totalPages: Math.ceil(total / pagination.limit),
      },
    });
  } catch (error) {
    console.error("Failed to list queues", error);
    return NextResponse.json(
      { error: "Unable to retrieve queues" },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  const scope = await requireOperationsContext(request);
  if (!scope.ok) return scope.response;
  if (!scope.context.access.canViewAllProjects)
    return NextResponse.json(
      { error: "Administrator access is required to create queues" },
      { status: 403 },
    );
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Request body must contain valid JSON" },
      { status: 400 },
    );
  }
  const validation = validateQueuePayload(body, false);
  if (!validation.ok)
    return NextResponse.json(
      { error: "Validation failed", details: validation.errors },
      { status: 422 },
    );
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await validateQueueReferences(
      client,
      scope.context.access.company.company_id,
      validation.data,
    );
    const result = await client.query(
      `INSERT INTO queues (
         company_id, project_id, team_id, queue_code, queue_name,
         description, assignment_strategy, created_by
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [
        scope.context.access.company.company_id,
        validation.data.project_id ?? null,
        validation.data.team_id ?? null,
        validation.data.queue_code,
        validation.data.queue_name,
        validation.data.description ?? null,
        validation.data.assignment_strategy ?? "manual",
        scope.context.userId,
      ],
    );
    await replaceQueueMembers(
      client,
      result.rows[0].queue_id,
      validation.data.member_user_ids ?? [],
    );
    await client.query("COMMIT");
    return NextResponse.json(
      { message: "Queue created", queue: result.rows[0] },
      { status: 201 },
    );
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    if (error instanceof OperationsReferenceError)
      return NextResponse.json({ error: error.message }, { status: 422 });
    if (getDatabaseErrorCode(error) === "23505")
      return NextResponse.json(
        { error: "Queue code already exists for this company" },
        { status: 409 },
      );
    console.error("Failed to create queue", error);
    return NextResponse.json(
      { error: "Unable to create queue" },
      { status: 500 },
    );
  } finally {
    client.release();
  }
}
