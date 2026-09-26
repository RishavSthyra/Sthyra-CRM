import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { ADMIN_ROLE_KEYS, createNotification, parseNotificationUuid, renderNotificationTemplate } from "@/lib/notifications";
import { requireOperationsContext } from "@/lib/operationsAccess";
import { isObject } from "@/utils/isObject";

type Context = { params: Promise<{ templateid: string }> };
export async function POST(request: NextRequest, context: Context) {
  const scope = await requireOperationsContext(request); if (!scope.ok) return scope.response;
  if (!ADMIN_ROLE_KEYS.has(scope.context.access.roleKey)) return NextResponse.json({ error: "Administrator access is required" }, { status: 403 });
  const id = parseNotificationUuid((await context.params).templateid);
  if (!id) return NextResponse.json({ error: "templateId must be a valid UUID" }, { status: 400 });
  let body: unknown = {}; try { const text = await request.text(); body = text ? JSON.parse(text) : {}; } catch { return NextResponse.json({ error: "Request body must contain valid JSON" }, { status: 400 }); }
  if (!isObject(body) || Array.isArray(body) || (body.variables !== undefined && (!isObject(body.variables) || Array.isArray(body.variables)))) return NextResponse.json({ error: "variables must be a JSON object" }, { status: 422 });
  try {
    const result = await pool.query("SELECT * FROM notification_templates WHERE template_id=$1 AND company_id=$2", [id, scope.context.access.company.company_id]);
    if (!result.rowCount) return NextResponse.json({ error: "Notification template not found" }, { status: 404 });
    const template = result.rows[0]; const variables = (body.variables ?? {}) as Record<string, unknown>;
    const title = renderNotificationTemplate(template.subject_template, variables) ?? template.template_name;
    const renderedBody = renderNotificationTemplate(template.body_template, variables) ?? template.body_template;
    const notification = await createNotification(pool, { companyId: Number(template.company_id), projectId: template.project_id, userId: scope.context.userId, templateId: id, type: `template_test.${template.template_key}`, title, body: renderedBody, severity: template.severity, actionUrl: renderNotificationTemplate(template.action_url_template, variables), metadata: { test: true, variables }, channels: template.channels });
    return NextResponse.json({ message: "Test notification created", preview: { title, body: renderedBody, action_url: renderNotificationTemplate(template.action_url_template, variables), channels: template.channels }, notification });
  } catch (error) { console.error("Failed to test notification template", error); return NextResponse.json({ error: "Unable to test notification template" }, { status: 500 }); }
}
