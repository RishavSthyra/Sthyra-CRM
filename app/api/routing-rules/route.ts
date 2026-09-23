import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { OperationsReferenceError } from "@/lib/assignmentService";
import {
  ROUTING_RULE_COLUMNS,
  validateRoutingRulePayload,
} from "@/lib/operations";
import { requireOperationsContext } from "@/lib/operationsAccess";
import { getAccessibleProjectIds } from "@/lib/projectAccess";
import { validateRoutingReferences } from "@/lib/routingService";
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
    "r.company_id=$1",
    "(r.project_id IS NULL OR r.project_id=ANY($2::integer[]))",
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
    filters.push(`(r.project_id IS NULL OR r.project_id=$${values.length})`);
  }
  const active = request.nextUrl.searchParams.get("is_active");
  if (active !== null) {
    if (!["true", "false"].includes(active))
      return NextResponse.json(
        { error: "is_active must be true or false" },
        { status: 400 },
      );
    values.push(active === "true");
    filters.push(`r.is_active=$${values.length}`);
  }
  const where = `WHERE ${filters.join(" AND ")}`;
  try {
    const count = await pool.query(
      `SELECT COUNT(*)::integer AS total FROM routing_rules r ${where}`,
      values,
    );
    const listValues = [...values, pagination.limit, pagination.offset];
    const result = await pool.query(
      `SELECT ${ROUTING_RULE_COLUMNS}, p.project_name, q.queue_name,
        u.first_name AS target_user_first_name, u.last_name AS target_user_last_name,
        t.name AS target_team_name
       FROM routing_rules r
       LEFT JOIN projects p ON p.project_id=r.project_id
       LEFT JOIN queues q ON q.queue_id=r.target_queue_id
       LEFT JOIN users u ON u.user_id=r.target_user_id
       LEFT JOIN teams t ON t.team_id=r.target_team_id
       ${where} ORDER BY r.priority, r.created_at
       LIMIT $${listValues.length - 1} OFFSET $${listValues.length}`,
      listValues,
    );
    const total = Number(count.rows[0]?.total ?? 0);
    return NextResponse.json({
      rules: result.rows,
      pagination: {
        page: pagination.page,
        limit: pagination.limit,
        total,
        totalPages: Math.ceil(total / pagination.limit),
      },
    });
  } catch (error) {
    console.error("Failed to list routing rules", error);
    return NextResponse.json(
      { error: "Unable to retrieve routing rules" },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  const scope = await requireOperationsContext(request);
  if (!scope.ok) return scope.response;
  if (!scope.context.access.canViewAllProjects)
    return NextResponse.json(
      { error: "Administrator access is required to create routing rules" },
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
  const validation = validateRoutingRulePayload(body, false);
  if (!validation.ok)
    return NextResponse.json(
      { error: "Validation failed", details: validation.errors },
      { status: 422 },
    );
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await validateRoutingReferences(
      client,
      scope.context.access.company.company_id,
      validation.data,
    );
    const result = await client.query(
      `INSERT INTO routing_rules (
         company_id, project_id, rule_name, description, priority, conditions,
         action_type, target_queue_id, target_user_id, target_team_id, created_by
       ) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10,$11) RETURNING *`,
      [
        scope.context.access.company.company_id,
        validation.data.project_id ?? null,
        validation.data.rule_name,
        validation.data.description ?? null,
        validation.data.priority ?? 100,
        JSON.stringify(validation.data.conditions ?? {}),
        validation.data.action_type,
        validation.data.target_queue_id ?? null,
        validation.data.target_user_id ?? null,
        validation.data.target_team_id ?? null,
        scope.context.userId,
      ],
    );
    await client.query("COMMIT");
    return NextResponse.json(
      { message: "Routing rule created", rule: result.rows[0] },
      { status: 201 },
    );
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    if (error instanceof OperationsReferenceError)
      return NextResponse.json({ error: error.message }, { status: 422 });
    if (getDatabaseErrorCode(error) === "23505")
      return NextResponse.json(
        { error: "A routing rule with this name already exists" },
        { status: 409 },
      );
    console.error("Failed to create routing rule", error);
    return NextResponse.json(
      { error: "Unable to create routing rule" },
      { status: 500 },
    );
  } finally {
    client.release();
  }
}
