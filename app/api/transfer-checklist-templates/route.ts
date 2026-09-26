import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { requireOperationsContext } from "@/lib/operationsAccess";
import { getAccessibleProjectIds } from "@/lib/projectAccess";
import { validateTransferTemplate } from "@/lib/transfers";
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
  const values: unknown[] = [scope.context.access.company.company_id, projectIds];
  const filters = ["t.company_id=$1", "(t.project_id IS NULL OR t.project_id=ANY($2::integer[]))"];
  const projectValue = request.nextUrl.searchParams.get("project_id");
  if (projectValue) {
    const projectId = parsePositiveInteger(projectValue);
    if (!projectId || !projectIds.includes(projectId))
      return NextResponse.json({ error: "Invalid or inaccessible project_id" }, { status: 400 });
    values.push(projectId);
    filters.push(`(t.project_id IS NULL OR t.project_id=$${values.length})`);
  }
  const active = request.nextUrl.searchParams.get("is_active");
  if (active !== null) {
    if (!["true", "false"].includes(active))
      return NextResponse.json({ error: "is_active must be true or false" }, { status: 400 });
    values.push(active === "true");
    filters.push(`t.is_active=$${values.length}`);
  }
  const appliesTo = request.nextUrl.searchParams.get("applies_to");
  if (appliesTo) {
    if (!["lead", "opportunity", "both"].includes(appliesTo))
      return NextResponse.json({ error: "Invalid applies_to" }, { status: 400 });
    values.push(appliesTo);
    filters.push(`t.applies_to IN ($${values.length},'both')`);
  }
  const where = `WHERE ${filters.join(" AND ")}`;
  try {
    const count = await pool.query(`SELECT COUNT(*)::integer AS total FROM transfer_checklist_templates t ${where}`, values);
    const listValues = [...values, pagination.limit, pagination.offset];
    const result = await pool.query(
      `SELECT t.*, p.project_name,
        COUNT(i.item_id)::integer AS item_count
       FROM transfer_checklist_templates t
       LEFT JOIN projects p ON p.project_id=t.project_id
       LEFT JOIN transfer_checklist_template_items i ON i.template_id=t.template_id
       ${where}
       GROUP BY t.template_id, p.project_name
       ORDER BY t.updated_at DESC, t.template_id DESC
       LIMIT $${listValues.length - 1} OFFSET $${listValues.length}`,
      listValues,
    );
    const total = Number(count.rows[0]?.total ?? 0);
    return NextResponse.json({
      templates: result.rows,
      pagination: { page: pagination.page, limit: pagination.limit, total, totalPages: Math.ceil(total / pagination.limit) },
    });
  } catch (error) {
    console.error("Failed to list transfer checklist templates", error);
    return NextResponse.json({ error: "Unable to retrieve transfer checklist templates" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const scope = await requireOperationsContext(request);
  if (!scope.ok) return scope.response;
  if (!scope.context.access.canViewAllProjects)
    return NextResponse.json({ error: "Administrator access is required" }, { status: 403 });
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must contain valid JSON" }, { status: 400 });
  }
  const validation = validateTransferTemplate(body, false);
  if (!validation.ok)
    return NextResponse.json({ error: "Validation failed", details: validation.errors }, { status: 422 });
  if (
    validation.data.project_id &&
    !scope.context.access.projects.some((project) => project.project_id === validation.data.project_id)
  )
    return NextResponse.json({ error: "Invalid or inaccessible project_id" }, { status: 422 });
  try {
    const result = await pool.query(
      `INSERT INTO transfer_checklist_templates (
         company_id, project_id, template_name, description, applies_to,
         created_by, updated_by
       ) VALUES ($1,$2,$3,$4,$5,$6,$6) RETURNING *`,
      [
        scope.context.access.company.company_id,
        validation.data.project_id ?? null,
        validation.data.template_name,
        validation.data.description ?? null,
        validation.data.applies_to ?? "both",
        scope.context.userId,
      ],
    );
    return NextResponse.json({ message: "Transfer checklist template created", template: result.rows[0] }, { status: 201 });
  } catch (error) {
    if (getDatabaseErrorCode(error) === "23505")
      return NextResponse.json({ error: "A template with this name already exists in this scope" }, { status: 409 });
    console.error("Failed to create transfer checklist template", error);
    return NextResponse.json({ error: "Unable to create transfer checklist template" }, { status: 500 });
  }
}

