import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { ADMIN_ROLE_KEYS, TEMPLATE_COLUMNS, validateNotificationTemplate } from "@/lib/notifications";
import { requireOperationsContext } from "@/lib/operationsAccess";
import { canAccessProject, getAccessibleProjectIds } from "@/lib/projectAccess";
import { parsePagination } from "@/utils/parsePagination";

export async function GET(request: NextRequest) {
  const scope = await requireOperationsContext(request); if (!scope.ok) return scope.response;
  const pagination = parsePagination(request.nextUrl.searchParams, 30, 100);
  if (!pagination.ok) return NextResponse.json({ error: pagination.error }, { status: 400 });
  const values: unknown[] = [scope.context.access.company.company_id, getAccessibleProjectIds(scope.context.access)];
  const filters = ["nt.company_id=$1", "(nt.project_id IS NULL OR nt.project_id=ANY($2::integer[]))"];
  const active = request.nextUrl.searchParams.get("active");
  if (active !== null) {
    if (!["true", "false"].includes(active)) return NextResponse.json({ error: "active must be true or false" }, { status: 400 });
    values.push(active === "true"); filters.push(`nt.is_active=$${values.length}`);
  }
  try {
    const where = `WHERE ${filters.join(" AND ")}`;
    const count = await pool.query(`SELECT COUNT(*)::integer AS total FROM notification_templates nt ${where}`, values);
    const listValues = [...values, pagination.limit, pagination.offset];
    const result = await pool.query(`SELECT ${TEMPLATE_COLUMNS} FROM notification_templates nt ${where} ORDER BY nt.template_name, nt.template_id LIMIT $${listValues.length - 1} OFFSET $${listValues.length}`, listValues);
    const total = Number(count.rows[0]?.total ?? 0);
    return NextResponse.json({ templates: result.rows, pagination: { page: pagination.page, limit: pagination.limit, total, totalPages: Math.ceil(total / pagination.limit) } });
  } catch (error) { console.error("Failed to list notification templates", error); return NextResponse.json({ error: "Unable to retrieve notification templates" }, { status: 500 }); }
}

export async function POST(request: NextRequest) {
  const scope = await requireOperationsContext(request); if (!scope.ok) return scope.response;
  if (!ADMIN_ROLE_KEYS.has(scope.context.access.roleKey)) return NextResponse.json({ error: "Administrator access is required" }, { status: 403 });
  let body: unknown; try { body = await request.json(); } catch { return NextResponse.json({ error: "Request body must contain valid JSON" }, { status: 400 }); }
  const validation = validateNotificationTemplate(body, false);
  if (!validation.ok) return NextResponse.json({ error: "Validation failed", details: validation.errors }, { status: 422 });
  if (validation.data.project_id && !canAccessProject(scope.context.access, validation.data.project_id)) return NextResponse.json({ error: "You do not have access to this project" }, { status: 403 });
  const data = validation.data;
  try {
    const result = await pool.query(
      `INSERT INTO notification_templates (company_id, project_id, template_key, template_name, description,
       channels, subject_template, body_template, severity, action_url_template, variables, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$12) RETURNING *`,
      [scope.context.access.company.company_id, data.project_id ?? null, data.template_key, data.template_name,
       data.description ?? null, data.channels ?? ["in_app"], data.subject_template ?? null, data.body_template,
       data.severity ?? "info", data.action_url_template ?? null, data.variables ?? [], scope.context.userId],
    );
    return NextResponse.json({ message: "Notification template created", template: result.rows[0] }, { status: 201 });
  } catch (error) {
    if ((error as { code?: string }).code === "23505") return NextResponse.json({ error: "A template with this key already exists in this scope" }, { status: 409 });
    console.error("Failed to create notification template", error); return NextResponse.json({ error: "Unable to create notification template" }, { status: 500 });
  }
}
