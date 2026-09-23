import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import {
  markOverdueSlaInstances,
  parseUuid,
  SLA_INSTANCE_COLUMNS,
} from "@/lib/operations";
import { requireOperationsContext } from "@/lib/operationsAccess";
import { getAccessibleProjectIds } from "@/lib/projectAccess";
import { parsePagination } from "@/utils/parsePagination";
import { parsePositiveInteger } from "@/utils/parsePositiveInteger";

const STATUSES = [
  "running",
  "met",
  "breached",
  "escalated",
  "waived",
  "cancelled",
];

async function listSlaInstances(request: NextRequest, breachOnly = false) {
  const scope = await requireOperationsContext(request);
  if (!scope.ok) return scope.response;
  const pagination = parsePagination(request.nextUrl.searchParams);
  if (!pagination.ok) {
    return NextResponse.json({ error: pagination.error }, { status: 400 });
  }
  const projectIds = getAccessibleProjectIds(scope.context.access);
  const values: unknown[] = [
    scope.context.access.company.company_id,
    projectIds,
  ];
  const filters = ["i.company_id=$1", "i.project_id=ANY($2::integer[])"];
  if (breachOnly) filters.push("i.status IN ('breached','escalated')");

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
    filters.push(`i.project_id=$${values.length}`);
  }
  const status = request.nextUrl.searchParams.get("status");
  if (status) {
    if (
      !STATUSES.includes(status) ||
      (breachOnly && !["breached", "escalated"].includes(status))
    ) {
      return NextResponse.json(
        { error: "Invalid SLA status" },
        { status: 400 },
      );
    }
    values.push(status);
    filters.push(`i.status=$${values.length}`);
  }
  for (const field of ["sla_rule_id", "lead_id", "assignment_id"] as const) {
    const raw = request.nextUrl.searchParams.get(field);
    if (!raw) continue;
    const id = parseUuid(raw);
    if (!id) {
      return NextResponse.json(
        { error: `${field} must be a valid UUID` },
        { status: 400 },
      );
    }
    values.push(id);
    filters.push(`i.${field}=$${values.length}`);
  }
  const where = `WHERE ${filters.join(" AND ")}`;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await markOverdueSlaInstances(
      client,
      scope.context.access.company.company_id,
    );
    const count = await client.query(
      `SELECT COUNT(*)::integer AS total FROM sla_instances i ${where}`,
      values,
    );
    const listValues = [...values, pagination.limit, pagination.offset];
    const result = await client.query(
      `SELECT ${SLA_INSTANCE_COLUMNS}, s.rule_name, s.applies_to,
        s.escalation_minutes, p.project_name,
        c.first_name, c.last_name, c.email
       FROM sla_instances i
       JOIN sla_rules s ON s.sla_rule_id=i.sla_rule_id
       JOIN projects p ON p.project_id=i.project_id
       LEFT JOIN leads l ON l.lead_id=COALESCE(i.lead_id,
         (SELECT a.lead_id FROM assignments a WHERE a.assignment_id=i.assignment_id))
       LEFT JOIN contacts c ON c.contact_id=l.contact_id
       ${where}
       ORDER BY COALESCE(i.response_due_at, i.resolution_due_at), i.started_at
       LIMIT $${listValues.length - 1} OFFSET $${listValues.length}`,
      listValues,
    );
    await client.query("COMMIT");
    const total = Number(count.rows[0]?.total ?? 0);
    return NextResponse.json({
      [breachOnly ? "breaches" : "instances"]: result.rows,
      pagination: {
        page: pagination.page,
        limit: pagination.limit,
        total,
        totalPages: Math.ceil(total / pagination.limit),
      },
    });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    console.error("Failed to list SLA instances", error);
    return NextResponse.json(
      { error: "Unable to retrieve SLA instances" },
      { status: 500 },
    );
  } finally {
    client.release();
  }
}

export async function GET(request: NextRequest) {
  return listSlaInstances(
    request,
    request.nextUrl.pathname.endsWith("/sla-breaches"),
  );
}
