import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { ADMIN_ROLE_KEYS, parseNotificationUuid } from "@/lib/notifications";
import { requireOperationsContext } from "@/lib/operationsAccess";

type Context = { params: Promise<{ templateid: string }> };
export async function POST(request: NextRequest, context: Context) {
  const scope = await requireOperationsContext(request); if (!scope.ok) return scope.response;
  if (!ADMIN_ROLE_KEYS.has(scope.context.access.roleKey)) return NextResponse.json({ error: "Administrator access is required" }, { status: 403 });
  const id = parseNotificationUuid((await context.params).templateid);
  if (!id) return NextResponse.json({ error: "templateId must be a valid UUID" }, { status: 400 });
  try {
    const result = await pool.query(`UPDATE notification_templates SET is_active=TRUE, updated_by=$3, updated_at=CURRENT_TIMESTAMP WHERE template_id=$1 AND company_id=$2 RETURNING *`, [id, scope.context.access.company.company_id, scope.context.userId]);
    if (!result.rowCount) return NextResponse.json({ error: "Notification template not found" }, { status: 404 });
    return NextResponse.json({ message: "Notification template activated", template: result.rows[0] });
  } catch (error) { console.error("Failed to activate notification template", error); return NextResponse.json({ error: "Unable to activate notification template" }, { status: 500 }); }
}
