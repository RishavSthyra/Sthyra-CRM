import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { requireOperationsContext } from "@/lib/operationsAccess";
import { requirePermission } from "@/lib/authorization";
import { canAccessProject, getAccessibleProjectIds } from "@/lib/projectAccess";
import { parsePositiveInteger } from "@/utils/parsePositiveInteger";
import { WHATSAPP_TEMPLATE_CATEGORIES, validateTemplateName } from "@/lib/whatsapp";
import { createMetaTemplate, listMetaTemplates } from "@/lib/whatsappMeta";

async function syncTemplates(connection: Record<string, unknown>, actorUserId: string) {
  const payload = await listMetaTemplates(String(connection.waba_id), String(connection.access_token_ciphertext));
  const templates = Array.isArray(payload.data) ? payload.data : [];
  for (const raw of templates) {
    if (!raw || typeof raw !== "object") continue;
    const template = raw as Record<string, unknown>;
    const name = validateTemplateName(template.name);
    const language = typeof template.language === "string" ? template.language : "";
    const category = typeof template.category === "string" ? template.category.toUpperCase() : "UTILITY";
    if (!name || !language || !WHATSAPP_TEMPLATE_CATEGORIES.includes(category as never)) continue;
    await pool.query(
      `INSERT INTO whatsapp_templates (
         whatsapp_connection_id, company_id, project_id, meta_template_id,
         name, language, category, status, components, rejection_reason,
         created_by, last_synced_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,CURRENT_TIMESTAMP)
       ON CONFLICT (whatsapp_connection_id,name,language) DO UPDATE SET
         meta_template_id=EXCLUDED.meta_template_id, category=EXCLUDED.category,
         status=EXCLUDED.status, components=EXCLUDED.components,
         rejection_reason=EXCLUDED.rejection_reason,
         last_synced_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP`,
      [
        connection.whatsapp_connection_id, connection.company_id, connection.project_id,
        template.id ?? null, name, language, category,
        typeof template.status === "string" ? template.status.toUpperCase() : "PENDING",
        JSON.stringify(Array.isArray(template.components) ? template.components : []),
        template.rejected_reason ?? null, actorUserId,
      ],
    );
  }
  await pool.query(
    "UPDATE whatsapp_connections SET last_synced_at=CURRENT_TIMESTAMP,last_error=NULL,updated_at=CURRENT_TIMESTAMP WHERE whatsapp_connection_id=$1",
    [connection.whatsapp_connection_id],
  );
}
export async function GET(request: NextRequest) {
  const scope = await requireOperationsContext(request);
  if (!scope.ok) return scope.response;
  const projectValue = request.nextUrl.searchParams.get("project_id");
  const projectId = projectValue ? parsePositiveInteger(projectValue) : null;
  if (projectValue && (!projectId || !canAccessProject(scope.context.access, projectId))) {
    return NextResponse.json({ error: "Invalid project_id" }, { status: 400 });
  }
  if (request.nextUrl.searchParams.get("sync") === "1") {
    const connections = await pool.query(
      `SELECT * FROM whatsapp_connections WHERE company_id=$1 AND status='connected'
       AND project_id=ANY($2::integer[]) ${projectId ? "AND project_id=$3" : ""}`,
      projectId
        ? [scope.context.access.company.company_id, getAccessibleProjectIds(scope.context.access), projectId]
        : [scope.context.access.company.company_id, getAccessibleProjectIds(scope.context.access)],
    );
    for (const connection of connections.rows) {
      try { await syncTemplates(connection, scope.context.userId); }
      catch (error) {
        await pool.query(
          "UPDATE whatsapp_connections SET last_error=$2,updated_at=CURRENT_TIMESTAMP WHERE whatsapp_connection_id=$1",
          [connection.whatsapp_connection_id, (error instanceof Error ? error.message : "Template sync failed").slice(0, 5000)],
        );
      }
    }
  }
  const values: unknown[] = [getAccessibleProjectIds(scope.context.access)];
  const filters = ["template.project_id=ANY($1::integer[])"];
  if (projectId) { values.push(projectId); filters.push(`template.project_id=$${values.length}`); }
  const result = await pool.query(
    `SELECT template.*, connection.display_phone_number, connection.verified_name
     FROM whatsapp_templates template
     JOIN whatsapp_connections connection ON connection.whatsapp_connection_id=template.whatsapp_connection_id
     WHERE ${filters.join(" AND ")}
     ORDER BY template.name, template.language`, values,
  );
  return NextResponse.json({ templates: result.rows });
}

export async function POST(request: NextRequest) {
  const scope = await requirePermission(request, "WORKSPACE_MANAGE");
  if (!scope.ok) return scope.response;
  if (!scope.context.access.canViewAllProjects) return NextResponse.json({ error: "Company administrator access is required" }, { status: 403 });
  let body: Record<string, unknown>;
  try { body = await request.json() as Record<string, unknown>; }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const projectId = parsePositiveInteger(typeof body.project_id === "number" ? String(body.project_id) : body.project_id as string | null);
  const name = validateTemplateName(body.name);
  const language = typeof body.language === "string" ? body.language.trim().slice(0, 35) : "";
  const category = typeof body.category === "string" ? body.category.toUpperCase() : "";
  const components = Array.isArray(body.components) ? body.components : [];
  if (!projectId || !canAccessProject(scope.context.access, projectId) || !name || !language || !WHATSAPP_TEMPLATE_CATEGORIES.includes(category as never) || !components.length) {
    return NextResponse.json({ error: "Project, valid template name, language, category and message body are required" }, { status: 422 });
  }
  const connection = await pool.query(
    "SELECT * FROM whatsapp_connections WHERE project_id=$1 AND company_id=$2 AND status='connected'",
    [projectId, scope.context.access.company.company_id],
  );
  if (!connection.rowCount) return NextResponse.json({ error: "Connect WhatsApp to this project first" }, { status: 422 });
  try {
    const meta = await createMetaTemplate({
      wabaId: String(connection.rows[0].waba_id),
      encryptedToken: String(connection.rows[0].access_token_ciphertext),
      name, language, category, components,
    });
    const result = await pool.query(
      `INSERT INTO whatsapp_templates (
         whatsapp_connection_id, company_id, project_id, meta_template_id,
         name, language, category, status, components, created_by, last_synced_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,CURRENT_TIMESTAMP)
       ON CONFLICT (whatsapp_connection_id,name,language) DO UPDATE SET
         meta_template_id=EXCLUDED.meta_template_id, category=EXCLUDED.category,
         status=EXCLUDED.status, components=EXCLUDED.components,
         last_synced_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP
       RETURNING *`,
      [
        connection.rows[0].whatsapp_connection_id, scope.context.access.company.company_id,
        projectId, meta.id ?? null, name, language, category,
        typeof meta.status === "string" ? meta.status : "PENDING",
        JSON.stringify(components), scope.context.userId,
      ],
    );
    return NextResponse.json({ template: result.rows[0] }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to create template" }, { status: 502 });
  }
}
