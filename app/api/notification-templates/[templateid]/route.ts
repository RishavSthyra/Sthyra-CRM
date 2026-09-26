import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { ADMIN_ROLE_KEYS, TEMPLATE_COLUMNS, parseNotificationUuid, validateNotificationTemplate } from "@/lib/notifications";
import { canAccessOperationsEntity, requireOperationsContext } from "@/lib/operationsAccess";
import { canAccessProject } from "@/lib/projectAccess";

type Context = { params: Promise<{ templateid: string }> };
async function findTemplate(id: string) { const result = await pool.query(`SELECT ${TEMPLATE_COLUMNS} FROM notification_templates nt WHERE nt.template_id=$1`, [id]); return result.rows[0] ?? null; }

export async function GET(request: NextRequest, context: Context) {
  const scope = await requireOperationsContext(request); if (!scope.ok) return scope.response;
  const id = parseNotificationUuid((await context.params).templateid);
  if (!id) return NextResponse.json({ error: "templateId must be a valid UUID" }, { status: 400 });
  try {
    const template = await findTemplate(id);
    if (!template) return NextResponse.json({ error: "Notification template not found" }, { status: 404 });
    if (!canAccessOperationsEntity(scope.context.access, Number(template.company_id), template.project_id === null ? null : Number(template.project_id))) return NextResponse.json({ error: "You do not have access to this template" }, { status: 403 });
    return NextResponse.json({ template });
  } catch (error) { console.error("Failed to retrieve notification template", error); return NextResponse.json({ error: "Unable to retrieve notification template" }, { status: 500 }); }
}

export async function PATCH(request: NextRequest, context: Context) {
  const scope = await requireOperationsContext(request); if (!scope.ok) return scope.response;
  if (!ADMIN_ROLE_KEYS.has(scope.context.access.roleKey)) return NextResponse.json({ error: "Administrator access is required" }, { status: 403 });
  const id = parseNotificationUuid((await context.params).templateid);
  if (!id) return NextResponse.json({ error: "templateId must be a valid UUID" }, { status: 400 });
  let body: unknown; try { body = await request.json(); } catch { return NextResponse.json({ error: "Request body must contain valid JSON" }, { status: 400 }); }
  const validation = validateNotificationTemplate(body, true);
  if (!validation.ok) return NextResponse.json({ error: "Validation failed", details: validation.errors }, { status: 422 });
  if (validation.data.project_id && !canAccessProject(scope.context.access, validation.data.project_id)) return NextResponse.json({ error: "You do not have access to this project" }, { status: 403 });
  try {
    const current = await findTemplate(id);
    if (!current) return NextResponse.json({ error: "Notification template not found" }, { status: 404 });
    if (!canAccessOperationsEntity(scope.context.access, Number(current.company_id), current.project_id === null ? null : Number(current.project_id))) return NextResponse.json({ error: "You do not have access to this template" }, { status: 403 });
    const entries = Object.entries(validation.data); const values = entries.map(([, value]) => value); values.push(scope.context.userId, id);
    const result = await pool.query(`UPDATE notification_templates SET ${entries.map(([key], index) => `${key}=$${index + 1}`).join(", ")}, updated_by=$${values.length - 1}, updated_at=CURRENT_TIMESTAMP WHERE template_id=$${values.length} RETURNING *`, values);
    return NextResponse.json({ message: "Notification template updated", template: result.rows[0] });
  } catch (error) {
    if ((error as { code?: string }).code === "23505") return NextResponse.json({ error: "A template with this key already exists in this scope" }, { status: 409 });
    console.error("Failed to update notification template", error); return NextResponse.json({ error: "Unable to update notification template" }, { status: 500 });
  }
}
