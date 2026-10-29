import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { requireOperationsContext } from "@/lib/operationsAccess";
import { requirePermission } from "@/lib/authorization";
import { canAccessProject } from "@/lib/projectAccess";
import { parsePositiveInteger } from "@/utils/parsePositiveInteger";
import { encryptWhatsAppToken } from "@/lib/whatsapp";
import { exchangeEmbeddedSignupCode, getWhatsAppPhoneNumber, subscribeWhatsAppApp } from "@/lib/whatsappMeta";

export async function GET(request: NextRequest) {
  const scope = await requireOperationsContext(request);
  if (!scope.ok) return scope.response;
  const result = await pool.query(
    `SELECT whatsapp_connection_id, project_id, waba_id, phone_number_id,
            display_phone_number, verified_name, quality_rating, status,
            token_expires_at, last_webhook_at, last_synced_at, last_error,
            created_at, updated_at
     FROM whatsapp_connections
     WHERE company_id=$1 AND status <> 'disconnected'
       AND project_id=ANY($2::integer[])
     ORDER BY created_at DESC`,
    [scope.context.access.company.company_id, scope.context.access.projects.map((project) => project.project_id)],
  );
  return NextResponse.json({
    connections: result.rows,
    embedded_signup: {
      configured: Boolean(process.env.META_APP_ID && process.env.META_WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID),
      app_id: process.env.META_APP_ID ?? null,
      config_id: process.env.META_WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID ?? null,
      graph_version: process.env.META_GRAPH_API_VERSION ?? "v24.0",
    },
    can_manage: scope.context.access.canViewAllProjects,
  });
}
export async function POST(request: NextRequest) {
  const scope = await requirePermission(request, "WORKSPACE_MANAGE");
  if (!scope.ok) return scope.response;
  if (!scope.context.access.canViewAllProjects) {
    return NextResponse.json({ error: "Company administrator access is required" }, { status: 403 });
  }
  let body: Record<string, unknown>;
  try { body = await request.json() as Record<string, unknown>; }
  catch { return NextResponse.json({ error: "Request body must contain valid JSON" }, { status: 400 }); }
  const projectId = parsePositiveInteger(
    typeof body.project_id === "number"
      ? String(body.project_id)
      : typeof body.project_id === "string"
        ? body.project_id
        : null,
  );
  const code = typeof body.code === "string" ? body.code.trim() : "";
  const wabaId = typeof body.waba_id === "string" ? body.waba_id.trim() : "";
  const phoneNumberId = typeof body.phone_number_id === "string" ? body.phone_number_id.trim() : "";
  const businessId = typeof body.business_id === "string" ? body.business_id.trim() : null;
  if (!projectId || !canAccessProject(scope.context.access, projectId) || !code || !wabaId || !phoneNumberId) {
    return NextResponse.json({ error: "A project and the completed Meta signup details are required" }, { status: 422 });
  }
  try {
    const exchanged = await exchangeEmbeddedSignupCode(code);
    await subscribeWhatsAppApp(wabaId, exchanged.accessToken);
    const phone = await getWhatsAppPhoneNumber(phoneNumberId, exchanged.accessToken);
    const expiresAt = exchanged.expiresIn
      ? new Date(Date.now() + exchanged.expiresIn * 1000).toISOString()
      : null;
    const result = await pool.query(
      `INSERT INTO whatsapp_connections (
         company_id, project_id, meta_business_id, waba_id, phone_number_id,
         display_phone_number, verified_name, quality_rating,
         access_token_ciphertext, token_expires_at, status, created_by,
         last_synced_at, last_error
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'connected',$11,CURRENT_TIMESTAMP,NULL)
       ON CONFLICT (project_id) DO UPDATE SET
         meta_business_id=EXCLUDED.meta_business_id,
         waba_id=EXCLUDED.waba_id, display_phone_number=EXCLUDED.display_phone_number,
         phone_number_id=EXCLUDED.phone_number_id,
         verified_name=EXCLUDED.verified_name, quality_rating=EXCLUDED.quality_rating,
         access_token_ciphertext=EXCLUDED.access_token_ciphertext,
         token_expires_at=EXCLUDED.token_expires_at, status='connected',
         last_synced_at=CURRENT_TIMESTAMP, last_error=NULL, updated_at=CURRENT_TIMESTAMP
       RETURNING whatsapp_connection_id, project_id, waba_id, phone_number_id,
                 display_phone_number, verified_name, quality_rating, status`,
      [
        scope.context.access.company.company_id, projectId, businessId, wabaId,
        phoneNumberId, phone.display_phone_number ?? null, phone.verified_name ?? null,
        phone.quality_rating ?? null, encryptWhatsAppToken(exchanged.accessToken),
        expiresAt, scope.context.userId,
      ],
    );
    return NextResponse.json({ connection: result.rows[0] }, { status: 201 });
  } catch (error) {
    console.error("Unable to complete Meta WhatsApp signup", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to connect WhatsApp" }, { status: 502 });
  }
}
