import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { recordActivity } from "@/lib/activities";
import { requireOperationsContext } from "@/lib/operationsAccess";
import { canAccessProject, getAccessibleProjectIds } from "@/lib/projectAccess";
import { parsePagination } from "@/utils/parsePagination";
import { parsePositiveInteger } from "@/utils/parsePositiveInteger";
import { isWithinWhatsAppServiceWindow, normalizeWhatsAppPhone, parseWhatsAppId, templateTextParameters } from "@/lib/whatsapp";
import { processWhatsAppDeliveryJob } from "@/lib/whatsappDelivery";

export async function GET(request: NextRequest) {
  const scope = await requireOperationsContext(request);
  if (!scope.ok) return scope.response;
  const pagination = parsePagination(request.nextUrl.searchParams, 50, 100);
  if (!pagination.ok) return NextResponse.json({ error: pagination.error }, { status: 400 });
  const values: unknown[] = [getAccessibleProjectIds(scope.context.access)];
  const filters = ["message.project_id=ANY($1::integer[])"];
  const projectValue = request.nextUrl.searchParams.get("project_id");
  if (projectValue) {
    const projectId = parsePositiveInteger(projectValue);
    if (!projectId || !canAccessProject(scope.context.access, projectId)) return NextResponse.json({ error: "Invalid project_id" }, { status: 400 });
    values.push(projectId); filters.push(`message.project_id=$${values.length}`);
  }
  for (const field of ["lead_id", "contact_id"] as const) {
    const value = request.nextUrl.searchParams.get(field);
    if (!value) continue;
    const id = parseWhatsAppId(value);
    if (!id) return NextResponse.json({ error: `${field} must be a UUID` }, { status: 400 });
    values.push(id); filters.push(`message.${field}=$${values.length}`);
  }
  const where = `WHERE ${filters.join(" AND ")}`;
  const count = await pool.query(`SELECT COUNT(*)::integer AS total FROM whatsapp_messages message ${where}`, values);
  const listValues = [...values, pagination.limit, pagination.offset];
  const result = await pool.query(
    `SELECT message.*, contact.first_name AS contact_first_name,
            contact.last_name AS contact_last_name,
            owner.first_name AS owner_first_name, owner.last_name AS owner_last_name,
            project.project_name,
            (SELECT MAX(inbound.received_at) FROM whatsapp_messages inbound
             WHERE inbound.contact_id=message.contact_id AND inbound.direction='inbound') AS last_inbound_at
     FROM whatsapp_messages message
     JOIN projects project ON project.project_id=message.project_id
     LEFT JOIN contacts contact ON contact.contact_id=message.contact_id
     LEFT JOIN users owner ON owner.user_id=message.owner_user_id
     ${where}
     ORDER BY COALESCE(message.received_at,message.sent_at,message.created_at) DESC, message.whatsapp_message_id DESC
     LIMIT $${listValues.length - 1} OFFSET $${listValues.length}`,
    listValues,
  );
  const total = Number(count.rows[0]?.total ?? 0);
  return NextResponse.json({ messages: result.rows, pagination: { ...pagination, total, totalPages: Math.ceil(total / pagination.limit) } });
}
export async function POST(request: NextRequest) {
  const scope = await requireOperationsContext(request);
  if (!scope.ok) return scope.response;
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
  const leadId = body.lead_id == null ? null : parseWhatsAppId(body.lead_id);
  const contactIdInput = body.contact_id == null ? null : parseWhatsAppId(body.contact_id);
  const templateId = body.whatsapp_template_id == null ? null : parseWhatsAppId(body.whatsapp_template_id);
  const text = typeof body.body === "string" ? body.body.trim().slice(0, 4096) : "";
  if (!projectId || !canAccessProject(scope.context.access, projectId) || (!leadId && !contactIdInput)) {
    return NextResponse.json({ error: "A valid project and lead or contact are required" }, { status: 422 });
  }
  if (!text && !templateId) return NextResponse.json({ error: "Write a message or select a template" }, { status: 422 });
  const client = await pool.connect();
  let jobId = "";
  try {
    await client.query("BEGIN");
    const contactResult = leadId
      ? await client.query(
          `SELECT contact.contact_id, contact.phone_number
           FROM leads lead JOIN contacts contact ON contact.contact_id=lead.contact_id
           WHERE lead.lead_id=$1 AND lead.project_id=$2`, [leadId, projectId],
        )
      : await client.query("SELECT contact_id, phone_number FROM contacts WHERE contact_id=$1 AND archived_at IS NULL", [contactIdInput]);
    if (!contactResult.rowCount) throw new Error("The selected lead or contact was not found");
    const contactId = String(contactResult.rows[0].contact_id);
    const phone = normalizeWhatsAppPhone(contactResult.rows[0].phone_number);
    if (!phone) throw new Error("Add an international phone number to this contact first");
    const connection = await client.query(
      `SELECT * FROM whatsapp_connections WHERE project_id=$1 AND company_id=$2 AND status='connected'`,
      [projectId, scope.context.access.company.company_id],
    );
    if (!connection.rowCount) throw new Error("Connect a WhatsApp Business number to this project first");
    const lastInbound = await client.query(
      "SELECT MAX(received_at) AS last_inbound_at FROM whatsapp_messages WHERE contact_id=$1 AND direction='inbound'",
      [contactId],
    );
    const withinWindow = isWithinWhatsAppServiceWindow(lastInbound.rows[0]?.last_inbound_at);
    let consent = await client.query(
      `SELECT 1 FROM contact_consents WHERE contact_id=$1 AND channel='whatsapp'
       AND status='granted' AND (expires_at IS NULL OR expires_at>CURRENT_TIMESTAMP) LIMIT 1`,
      [contactId],
    );
    if (!consent.rowCount && body.confirm_opt_in === true) {
      await client.query(
        `INSERT INTO contact_consents (
           contact_id,consent_type,channel,status,legal_basis,source,notes
         ) VALUES ($1,'whatsapp_messaging','whatsapp','granted','consent',
                   'activity_whatsapp_composer','Contact opt-in confirmed by CRM user')
         ON CONFLICT (contact_id,consent_type,channel) WHERE status='granted' DO NOTHING`,
        [contactId],
      );
      consent = { ...consent, rowCount: 1 };
    }
    if (!consent.rowCount && !withinWindow) throw new Error("Record WhatsApp opt-in before starting this conversation");
    if (!templateId && !withinWindow) throw new Error("The 24-hour reply window is closed. Select an approved template");
    let template: Record<string, unknown> | null = null;
    if (templateId) {
      const found = await client.query(
        `SELECT * FROM whatsapp_templates WHERE whatsapp_template_id=$1
         AND whatsapp_connection_id=$2 AND status='APPROVED'`,
        [templateId, connection.rows[0].whatsapp_connection_id],
      );
      if (!found.rowCount) throw new Error("Select a template approved by Meta");
      template = found.rows[0];
    }
    const parameters = templateTextParameters(body.template_parameters).map((parameter) => parameter.text);
    const inserted = await client.query(
      `INSERT INTO whatsapp_messages (
         whatsapp_connection_id, company_id, project_id, lead_id, contact_id,
         owner_user_id, direction, message_type, status, recipient_phone, body,
         whatsapp_template_id, template_name, template_language, template_parameters
       ) VALUES ($1,$2,$3,$4,$5,$6,'outbound',$7,'queued',$8,$9,$10,$11,$12,$13::jsonb)
       RETURNING *`,
      [
        connection.rows[0].whatsapp_connection_id, scope.context.access.company.company_id,
        projectId, leadId, contactId, scope.context.userId, template ? "template" : "text",
        phone, text || null, templateId, template?.name ?? null, template?.language ?? null,
        JSON.stringify(parameters),
      ],
    );
    const job = await client.query(
      `INSERT INTO whatsapp_delivery_jobs (whatsapp_message_id, company_id, project_id)
       VALUES ($1,$2,$3) RETURNING whatsapp_delivery_job_id`,
      [inserted.rows[0].whatsapp_message_id, scope.context.access.company.company_id, projectId],
    );
    jobId = String(job.rows[0].whatsapp_delivery_job_id);
    await recordActivity(client, inserted.rows[0], "whatsapp", "whatsapp_message_queued", template ? `WhatsApp template queued: ${template.name}` : "WhatsApp message queued", scope.context.userId, { description: text || null });
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to queue WhatsApp message" }, { status: 422 });
  } finally { client.release(); }
  const delivery = await processWhatsAppDeliveryJob(jobId);
  return NextResponse.json({ queued: true, delivery }, { status: 201 });
}
