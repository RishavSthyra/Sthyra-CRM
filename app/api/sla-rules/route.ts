import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { SLA_RULE_COLUMNS, validateSlaRulePayload } from "@/lib/operations";
import { requireOperationsContext } from "@/lib/operationsAccess";
import { canAccessProject, getAccessibleProjectIds } from "@/lib/projectAccess";
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
    "s.company_id=$1",
    "(s.project_id IS NULL OR s.project_id=ANY($2::integer[]))",
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
    filters.push(`(s.project_id IS NULL OR s.project_id=$${values.length})`);
  }
  const active = request.nextUrl.searchParams.get("is_active");
  if (active !== null) {
    if (!["true", "false"].includes(active))
      return NextResponse.json(
        { error: "is_active must be true or false" },
        { status: 400 },
      );
    values.push(active === "true");
    filters.push(`s.is_active=$${values.length}`);
  }
  const appliesTo = request.nextUrl.searchParams.get("applies_to");
  if (appliesTo) {
    if (!["lead", "assignment"].includes(appliesTo))
      return NextResponse.json(
        { error: "applies_to must be lead or assignment" },
        { status: 400 },
      );
    values.push(appliesTo);
    filters.push(`s.applies_to=$${values.length}`);
  }
  const where = `WHERE ${filters.join(" AND ")}`;
  try {
    const count = await pool.query(
      `SELECT COUNT(*)::integer AS total FROM sla_rules s ${where}`,
      values,
    );
    const listValues = [...values, pagination.limit, pagination.offset];
    const result = await pool.query(
      `SELECT ${SLA_RULE_COLUMNS}, p.project_name
       FROM sla_rules s LEFT JOIN projects p ON p.project_id=s.project_id
       ${where} ORDER BY s.priority, s.created_at
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
    console.error("Failed to list SLA rules", error);
    return NextResponse.json(
      { error: "Unable to retrieve SLA rules" },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  const scope = await requireOperationsContext(request);
  if (!scope.ok) return scope.response;
  if (!scope.context.access.canViewAllProjects)
    return NextResponse.json(
      { error: "Administrator access is required to create SLA rules" },
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
  const validation = validateSlaRulePayload(body, false);
  if (!validation.ok)
    return NextResponse.json(
      { error: "Validation failed", details: validation.errors },
      { status: 422 },
    );
  if (
    validation.data.project_id &&
    !canAccessProject(scope.context.access, validation.data.project_id)
  )
    return NextResponse.json(
      { error: "Active company project not found" },
      { status: 422 },
    );
  try {
    const result = await pool.query(
      `INSERT INTO sla_rules (
         company_id, project_id, rule_name, description, applies_to,
         priority, conditions, response_minutes, resolution_minutes,
         escalation_minutes, created_by
       ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11) RETURNING *`,
      [
        scope.context.access.company.company_id,
        validation.data.project_id ?? null,
        validation.data.rule_name,
        validation.data.description ?? null,
        validation.data.applies_to ?? "assignment",
        validation.data.priority ?? 100,
        JSON.stringify(validation.data.conditions ?? {}),
        validation.data.response_minutes ?? null,
        validation.data.resolution_minutes ?? null,
        validation.data.escalation_minutes ?? null,
        scope.context.userId,
      ],
    );
    return NextResponse.json(
      { message: "SLA rule created", rule: result.rows[0] },
      { status: 201 },
    );
  } catch (error) {
    if (getDatabaseErrorCode(error) === "23505")
      return NextResponse.json(
        { error: "An SLA rule with this name already exists" },
        { status: 409 },
      );
    console.error("Failed to create SLA rule", error);
    return NextResponse.json(
      { error: "Unable to create SLA rule" },
      { status: 500 },
    );
  }
}
