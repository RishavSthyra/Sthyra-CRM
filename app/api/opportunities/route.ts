import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { OPPORTUNITY_COLUMNS } from "@/lib/opportunities";
import { requireOperationsContext } from "@/lib/operationsAccess";
import { parseUuid } from "@/lib/operations";
import { getAccessibleProjectIds } from "@/lib/projectAccess";
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
  const filters = ["o.company_id=$1", "o.project_id=ANY($2::integer[])"];
  const projectValue = request.nextUrl.searchParams.get("project_id");
  if (projectValue) {
    const projectId = parsePositiveInteger(projectValue);
    if (!projectId || !projectIds.includes(projectId))
      return NextResponse.json(
        { error: "Invalid or inaccessible project_id" },
        { status: 400 },
      );
    values.push(projectId);
    filters.push(`o.project_id=$${values.length}`);
  }
  const status = request.nextUrl.searchParams.get("status");
  if (status) {
    if (!["open", "closed"].includes(status))
      return NextResponse.json(
        { error: "Invalid opportunity status" },
        { status: 400 },
      );
    values.push(status);
    filters.push(`o.status=$${values.length}`);
  }
  const outcome = request.nextUrl.searchParams.get("outcome");
  if (outcome) {
    if (!["won", "lost"].includes(outcome))
      return NextResponse.json(
        { error: "Invalid opportunity outcome" },
        { status: 400 },
      );
    values.push(outcome);
    filters.push(`o.outcome=$${values.length}`);
  }
  const stageKey = request.nextUrl.searchParams.get("stage_key")?.trim();
  if (stageKey) {
    values.push(stageKey.toLowerCase());
    filters.push(`o.stage_key=$${values.length}`);
  }
  for (const field of [
    "lead_id",
    "contact_id",
    "current_owner_user_id",
    "current_team_id",
  ] as const) {
    const raw = request.nextUrl.searchParams.get(field);
    if (!raw) continue;
    const id = parseUuid(raw);
    if (!id)
      return NextResponse.json(
        { error: `${field} must be a valid UUID` },
        { status: 400 },
      );
    values.push(id);
    filters.push(`o.${field}=$${values.length}`);
  }
  const search = request.nextUrl.searchParams.get("search")?.trim();
  if (search) {
    values.push(`%${search}%`);
    filters.push(
      `(o.opportunity_name ILIKE $${values.length} OR c.first_name ILIKE $${values.length} OR c.last_name ILIKE $${values.length} OR c.email ILIKE $${values.length})`,
    );
  }
  const where = `WHERE ${filters.join(" AND ")}`;
  try {
    const stageValues: unknown[] = [projectIds];
    const stageFilters = ["project_id=ANY($1::integer[])", "is_active=TRUE"];
    if (projectValue) {
      stageValues.push(Number(projectValue));
      stageFilters.push(`project_id=$${stageValues.length}`);
    }
    const [count, stages] = await Promise.all([
      pool.query(
        `SELECT COUNT(*)::integer AS total
         FROM opportunities o JOIN contacts c ON c.contact_id=o.contact_id ${where}`,
        values,
      ),
      pool.query(
        `SELECT stage_key,
           (ARRAY_AGG(stage_name ORDER BY position, stage_id))[1] AS stage_name,
           MIN(position)::integer AS position,
           ROUND(AVG(probability))::integer AS probability,
           (ARRAY_AGG(color ORDER BY position, stage_id))[1] AS color,
           BOOL_OR(is_initial) AS is_initial
         FROM project_opportunity_stages
         WHERE ${stageFilters.join(" AND ")}
         GROUP BY stage_key
         ORDER BY MIN(position), stage_key`,
        stageValues,
      ),
    ]);
    const listValues = [...values, pagination.limit, pagination.offset];
    const result = await pool.query(
      `SELECT ${OPPORTUNITY_COLUMNS}, p.project_name, p.project_code,
         c.first_name, c.last_name, c.email, c.phone_number,
         owner.first_name AS owner_first_name, owner.last_name AS owner_last_name,
         team.name AS team_name
       FROM opportunities o
       JOIN projects p ON p.project_id=o.project_id
       JOIN contacts c ON c.contact_id=o.contact_id
       LEFT JOIN users owner ON owner.user_id=o.current_owner_user_id
       LEFT JOIN teams team ON team.team_id=o.current_team_id
       ${where}
       ORDER BY o.updated_at DESC, o.opportunity_id DESC
       LIMIT $${listValues.length - 1} OFFSET $${listValues.length}`,
      listValues,
    );
    const total = Number(count.rows[0]?.total ?? 0);
    return NextResponse.json({
      opportunities: result.rows,
      stages: stages.rows,
      pagination: {
        page: pagination.page,
        limit: pagination.limit,
        total,
        totalPages: Math.ceil(total / pagination.limit),
      },
    });
  } catch (error) {
    console.error("Failed to list opportunities", error);
    return NextResponse.json(
      { error: "Unable to retrieve opportunities" },
      { status: 500 },
    );
  }
}
