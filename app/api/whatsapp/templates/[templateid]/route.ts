import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { requirePermission } from "@/lib/authorization";
import { WHATSAPP_TEMPLATE_CATEGORIES, parseWhatsAppId } from "@/lib/whatsapp";
import { editMetaTemplate } from "@/lib/whatsappMeta";

type Context = { params: Promise<{ templateid: string }> };

export async function PATCH(request: NextRequest, context: Context) {
  const scope = await requirePermission(request, "WORKSPACE_MANAGE");
  if (!scope.ok) return scope.response;
  if (!scope.context.access.canViewAllProjects) return NextResponse.json({ error: "Company administrator access is required" }, { status: 403 });
  const templateId = parseWhatsAppId((await context.params).templateid);
  let body: Record<string, unknown>;
  try { body = await request.json() as Record<string, unknown>; }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const category = typeof body.category === "string" ? body.category.toUpperCase() : "";
  const components = Array.isArray(body.components) ? body.components : [];
  if (!templateId || !WHATSAPP_TEMPLATE_CATEGORIES.includes(category as never) || !components.length) {
    return NextResponse.json({ error: "Category and template content are required" }, { status: 422 });
  }
  const found = await pool.query(
    `SELECT template.*, connection.access_token_ciphertext
     FROM whatsapp_templates template
     JOIN whatsapp_connections connection ON connection.whatsapp_connection_id=template.whatsapp_connection_id
     WHERE template.whatsapp_template_id=$1 AND template.company_id=$2`,
    [templateId, scope.context.access.company.company_id],
  );
  if (!found.rowCount) return NextResponse.json({ error: "Template not found" }, { status: 404 });
  if (!found.rows[0].meta_template_id) return NextResponse.json({ error: "Sync this template with Meta before editing" }, { status: 422 });
  try {
    await editMetaTemplate({
      metaTemplateId: String(found.rows[0].meta_template_id),
      encryptedToken: String(found.rows[0].access_token_ciphertext),
      category,
      components,
    });
    const result = await pool.query(
      `UPDATE whatsapp_templates SET category=$2,components=$3::jsonb,status='PENDING',
         rejection_reason=NULL,last_synced_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP
       WHERE whatsapp_template_id=$1 RETURNING *`,
      [templateId, category, JSON.stringify(components)],
    );
    return NextResponse.json({ template: result.rows[0] });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to edit template" }, { status: 502 });
  }
}
