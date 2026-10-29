import { adminPool } from "@/lib/db";
import { recordActivity } from "@/lib/activities";
import { renderAutomationParameters } from "@/lib/whatsapp";
import { sendMetaWhatsAppMessage } from "@/lib/whatsappMeta";

type JobRow = Record<string, unknown>;

function providerMessageId(payload: Record<string, unknown>) {
  const messages = Array.isArray(payload.messages) ? payload.messages : [];
  const first = messages[0];
  return first && typeof first === "object" && typeof (first as Record<string, unknown>).id === "string"
    ? String((first as Record<string, unknown>).id)
    : null;
}
async function failJob(job: JobRow, error: unknown) {
  const message = (error instanceof Error ? error.message : "WhatsApp delivery failed").slice(0, 5000);
  await adminPool.query(
    `UPDATE whatsapp_delivery_jobs
     SET status=CASE WHEN attempts >= max_attempts THEN 'failed' ELSE 'retrying' END,
         last_error=$2,
         next_attempt_at=CURRENT_TIMESTAMP + (POWER(2,LEAST(attempts,8)) * INTERVAL '2 minutes'),
         updated_at=CURRENT_TIMESTAMP
     WHERE whatsapp_delivery_job_id=$1`,
    [job.whatsapp_delivery_job_id, message],
  );
  if (job.whatsapp_message_id) {
    await adminPool.query(
      `UPDATE whatsapp_messages SET status='failed', error_message=$2,
         failed_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP
       WHERE whatsapp_message_id=$1`,
      [job.whatsapp_message_id, message],
    );
  }
  return { sent: false, error: message };
}

async function claimJob(jobId?: string): Promise<JobRow | null> {
  const client = await adminPool.connect();
  try {
    await client.query("BEGIN");
    const values: unknown[] = [];
    const idFilter = jobId ? (values.push(jobId), `AND job.whatsapp_delivery_job_id=$${values.length}`) : "";
    const result = await client.query(
      `WITH candidate AS (
         SELECT job.whatsapp_delivery_job_id
         FROM whatsapp_delivery_jobs job
         WHERE job.status IN ('queued','retrying')
           AND job.attempts < job.max_attempts
           AND job.next_attempt_at <= CURRENT_TIMESTAMP
           ${idFilter}
         ORDER BY job.next_attempt_at, job.created_at
         FOR UPDATE SKIP LOCKED LIMIT 1
       )
       UPDATE whatsapp_delivery_jobs job
       SET status='processing', attempts=attempts+1, locked_at=CURRENT_TIMESTAMP,
           last_error=NULL, updated_at=CURRENT_TIMESTAMP
       FROM candidate WHERE job.whatsapp_delivery_job_id=candidate.whatsapp_delivery_job_id
       RETURNING job.*`,
      values,
    );
    await client.query("COMMIT");
    return result.rows[0] ?? null;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function materializeAutomationMessage(job: JobRow): Promise<string> {
  const result = await adminPool.query(
    `SELECT rule.*, template.name AS template_name, template.language AS template_language,
            template.status AS template_status,
            connection.phone_number_id, connection.access_token_ciphertext,
            connection.status AS connection_status,
            COALESCE(activity.lead_id,job.lead_id) AS lead_id,
            COALESCE(activity.contact_id,job.contact_id) AS contact_id,
            COALESCE(activity.title,job.event_context->>'activity_title',rule.name) AS title,
            contact.first_name, contact.last_name, contact.phone_number,
            project.project_name
     FROM whatsapp_automation_rules rule
     JOIN whatsapp_delivery_jobs job ON job.whatsapp_delivery_job_id=$3
     JOIN whatsapp_templates template ON template.whatsapp_template_id=rule.whatsapp_template_id
     JOIN whatsapp_connections connection ON connection.whatsapp_connection_id=rule.whatsapp_connection_id
     LEFT JOIN activities activity ON activity.activity_id=$2
     JOIN contacts contact ON contact.contact_id=COALESCE(activity.contact_id,job.contact_id)
     JOIN projects project ON project.project_id=rule.project_id
     WHERE rule.whatsapp_automation_rule_id=$1 AND rule.is_active=TRUE`,
    [job.whatsapp_automation_rule_id, job.activity_id, job.whatsapp_delivery_job_id],
  );
  if (!result.rowCount) throw new Error("The WhatsApp automation is no longer active");
  const row = result.rows[0];
  if (row.template_status !== "APPROVED") throw new Error("The automation template is not approved by Meta");
  if (row.connection_status !== "connected") throw new Error("The WhatsApp number is not connected");
  const consent = await adminPool.query(
    `SELECT 1 FROM contact_consents
     WHERE contact_id=$1 AND channel='whatsapp' AND status='granted'
       AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP) LIMIT 1`,
    [row.contact_id],
  );
  if (!consent.rowCount) throw new Error("The contact has not opted in to WhatsApp messages");
  const phone = String(row.phone_number ?? "").replace(/\D/g, "");
  if (phone.length < 8) throw new Error("The contact does not have a valid international phone number");
  const parameters = renderAutomationParameters(row.template_parameters, {
    first_name: row.first_name,
    last_name: row.last_name,
    full_name: [row.first_name, row.last_name].filter(Boolean).join(" "),
    project_name: row.project_name,
    activity_title: row.title,
  });
  const inserted = await adminPool.query(
    `INSERT INTO whatsapp_messages (
       whatsapp_connection_id, company_id, project_id, lead_id, contact_id,
       direction, message_type, status, recipient_phone, whatsapp_template_id,
       template_name, template_language, template_parameters
     ) VALUES ($1,$2,$3,$4,$5,'outbound','template','sending',$6,$7,$8,$9,$10::jsonb)
     RETURNING whatsapp_message_id`,
    [
      row.whatsapp_connection_id, row.company_id, row.project_id, row.lead_id,
      row.contact_id, phone, row.whatsapp_template_id, row.template_name,
      row.template_language, JSON.stringify(parameters),
    ],
  );
  const messageId = String(inserted.rows[0].whatsapp_message_id);
  await adminPool.query(
    "UPDATE whatsapp_delivery_jobs SET whatsapp_message_id=$2 WHERE whatsapp_delivery_job_id=$1",
    [job.whatsapp_delivery_job_id, messageId],
  );
  return messageId;
}

export async function processWhatsAppDeliveryJob(jobId?: string) {
  const job = await claimJob(jobId);
  if (!job) return null;
  try {
    const messageId = job.whatsapp_message_id
      ? String(job.whatsapp_message_id)
      : await materializeAutomationMessage(job);
    job.whatsapp_message_id = messageId;
    const loaded = await adminPool.query(
      `SELECT message.*, connection.phone_number_id, connection.access_token_ciphertext,
              connection.status AS connection_status
       FROM whatsapp_messages message
       JOIN whatsapp_connections connection
         ON connection.whatsapp_connection_id=message.whatsapp_connection_id
       WHERE message.whatsapp_message_id=$1`,
      [messageId],
    );
    if (!loaded.rowCount) throw new Error("WhatsApp message was not found");
    const message = loaded.rows[0];
    if (message.connection_status !== "connected") throw new Error("The WhatsApp number must be reconnected");
    await adminPool.query(
      "UPDATE whatsapp_messages SET status='sending', updated_at=CURRENT_TIMESTAMP WHERE whatsapp_message_id=$1",
      [messageId],
    );
    const response = await sendMetaWhatsAppMessage({
      phoneNumberId: String(message.phone_number_id),
      encryptedToken: String(message.access_token_ciphertext),
      to: String(message.recipient_phone),
      body: message.body ? String(message.body) : null,
      template: message.message_type === "template"
        ? {
            name: String(message.template_name),
            language: String(message.template_language),
            parameters: message.template_parameters,
          }
        : null,
    });
    const metaId = providerMessageId(response);
    await adminPool.query(
      `UPDATE whatsapp_messages SET status='sent', provider_message_id=$2,
         provider_payload=$3::jsonb, sent_at=CURRENT_TIMESTAMP,
         error_code=NULL, error_message=NULL, updated_at=CURRENT_TIMESTAMP
       WHERE whatsapp_message_id=$1`,
      [messageId, metaId, JSON.stringify(response)],
    );
    await adminPool.query(
      `UPDATE whatsapp_delivery_jobs SET status='sent', completed_at=CURRENT_TIMESTAMP,
         updated_at=CURRENT_TIMESTAMP WHERE whatsapp_delivery_job_id=$1`,
      [job.whatsapp_delivery_job_id],
    );
    await recordActivity(
      adminPool,
      { ...message, whatsapp_message_id: messageId },
      "whatsapp",
      "whatsapp_message_sent",
      message.message_type === "template" ? `WhatsApp template sent: ${message.template_name}` : "WhatsApp message sent",
      message.owner_user_id ? String(message.owner_user_id) : null,
      { description: message.body, metadata: { provider_message_id: metaId, status: "sent" } },
    );
    return { sent: true, messageId, providerMessageId: metaId };
  } catch (error) {
    return failJob(job, error);
  }
}
