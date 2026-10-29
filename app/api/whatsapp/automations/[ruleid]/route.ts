import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { requirePermission } from "@/lib/authorization";
import { parseWhatsAppId } from "@/lib/whatsapp";

type Context = { params: Promise<{ ruleid: string }> };

export async function PATCH(request: NextRequest, context: Context) {
  const scope = await requirePermission(request, "WORKSPACE_MANAGE");
  if (!scope.ok) return scope.response;
  if (!scope.context.access.canViewAllProjects) return NextResponse.json({ error: "Company administrator access is required" }, { status: 403 });
  const ruleId = parseWhatsAppId((await context.params).ruleid);
  let body: Record<string, unknown>;
  try { body = await request.json() as Record<string, unknown>; }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  if (!ruleId || typeof body.is_active !== "boolean") return NextResponse.json({ error: "is_active is required" }, { status: 422 });
  const result = await pool.query(
    `UPDATE whatsapp_automation_rules SET is_active=$2,updated_at=CURRENT_TIMESTAMP
     WHERE whatsapp_automation_rule_id=$1 AND company_id=$3 RETURNING *`,
    [ruleId, body.is_active, scope.context.access.company.company_id],
  );
  return result.rowCount
    ? NextResponse.json({ rule: result.rows[0] })
    : NextResponse.json({ error: "Automation not found" }, { status: 404 });
}
export async function DELETE(request: NextRequest, context: Context) {
  const scope = await requirePermission(request, "WORKSPACE_MANAGE");
  if (!scope.ok) return scope.response;
  if (!scope.context.access.canViewAllProjects) return NextResponse.json({ error: "Company administrator access is required" }, { status: 403 });
  const ruleId = parseWhatsAppId((await context.params).ruleid);
  if (!ruleId) return NextResponse.json({ error: "Invalid automation ID" }, { status: 400 });
  const result = await pool.query(
    "DELETE FROM whatsapp_automation_rules WHERE whatsapp_automation_rule_id=$1 AND company_id=$2 RETURNING whatsapp_automation_rule_id",
    [ruleId, scope.context.access.company.company_id],
  );
  return result.rowCount ? NextResponse.json({ deleted: true }) : NextResponse.json({ error: "Automation not found" }, { status: 404 });
}
