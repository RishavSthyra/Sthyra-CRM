import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { requirePermission } from "@/lib/authorization";
import { canAccessProject, getAccessibleProjectIds } from "@/lib/projectAccess";
import { parsePositiveInteger } from "@/utils/parsePositiveInteger";
import { WHATSAPP_AUTOMATION_TRIGGERS, parseWhatsAppId } from "@/lib/whatsapp";

export async function GET(request: NextRequest) {
  const scope = await requirePermission(request, "WORKSPACE_MANAGE");
  if (!scope.ok) return scope.response;
  const result = await pool.query(
    `SELECT rule.*, template.name AS template_name, template.language AS template_language,
            template.status AS template_status
     FROM whatsapp_automation_rules rule
     JOIN whatsapp_templates template ON template.whatsapp_template_id=rule.whatsapp_template_id
     WHERE rule.project_id=ANY($1::integer[])
     ORDER BY rule.created_at DESC`,
    [getAccessibleProjectIds(scope.context.access)],
  );
  return NextResponse.json({ rules: result.rows, triggers: WHATSAPP_AUTOMATION_TRIGGERS });
}
export async function POST(request: NextRequest) {
  const scope = await requirePermission(request, "WORKSPACE_MANAGE");
  if (!scope.ok) return scope.response;
  if (!scope.context.access.canViewAllProjects) return NextResponse.json({ error: "Company administrator access is required" }, { status: 403 });
  let body: Record<string, unknown>;
  try { body = await request.json() as Record<string, unknown>; }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const projectId = parsePositiveInteger(typeof body.project_id === "number" ? String(body.project_id) : body.project_id as string | null);
  const templateId = parseWhatsAppId(body.whatsapp_template_id);
  const name = typeof body.name === "string" ? body.name.trim().slice(0, 160) : "";
  const trigger = typeof body.trigger_activity_type === "string" ? body.trigger_activity_type.trim() : "";
  const parameters = Array.isArray(body.template_parameters)
    ? body.template_parameters.filter((value): value is string => typeof value === "string").slice(0, 20)
    : [];
  if (!projectId || !canAccessProject(scope.context.access, projectId) || !templateId || !name || !WHATSAPP_AUTOMATION_TRIGGERS.includes(trigger as never)) {
    return NextResponse.json({ error: "Project, name, supported trigger and approved template are required" }, { status: 422 });
  }
  const result = await pool.query(
    `INSERT INTO whatsapp_automation_rules (
       whatsapp_connection_id, whatsapp_template_id, company_id, project_id,
       name, trigger_activity_type, template_parameters, created_by
     )
     SELECT template.whatsapp_connection_id, template.whatsapp_template_id,
            template.company_id, template.project_id, $3, $4, $5::jsonb, $6
     FROM whatsapp_templates template
     WHERE template.whatsapp_template_id=$1 AND template.project_id=$2 AND template.status='APPROVED'
     RETURNING *`,
    [templateId, projectId, name, trigger, JSON.stringify(parameters), scope.context.userId],
  );
  if (!result.rowCount) return NextResponse.json({ error: "The selected template is not approved for this project" }, { status: 422 });
  return NextResponse.json({ rule: result.rows[0] }, { status: 201 });
}
