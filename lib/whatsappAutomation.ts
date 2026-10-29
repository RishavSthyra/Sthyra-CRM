import type { PoolClient } from "pg";

export async function queueWhatsAppAutomationEvent(
  database: Pick<PoolClient, "query">,
  input: {
    companyId: number;
    projectId: number;
    eventName: string;
    leadId?: string | null;
    contactId?: string | null;
    opportunityId?: string | null;
    context?: Record<string, unknown>;
  },
) {
  let leadId = input.leadId ?? null;
  let contactId = input.contactId ?? null;
  if (!contactId && (leadId || input.opportunityId)) {
    const relation = await database.query(
      `SELECT lead.lead_id,lead.contact_id
       FROM leads lead
       LEFT JOIN opportunities opportunity ON opportunity.lead_id=lead.lead_id
       WHERE ($1::uuid IS NOT NULL AND lead.lead_id=$1)
          OR ($2::uuid IS NOT NULL AND opportunity.opportunity_id=$2)
       ORDER BY opportunity.created_at DESC NULLS LAST LIMIT 1`,
      [leadId, input.opportunityId ?? null],
    );
    leadId = relation.rows[0]?.lead_id ?? leadId;
    contactId = relation.rows[0]?.contact_id ?? null;
  }
  if (!contactId) return 0;
  const result = await database.query(
    `INSERT INTO whatsapp_delivery_jobs (
       whatsapp_automation_rule_id,lead_id,contact_id,company_id,project_id,event_context
     )
     SELECT rule.whatsapp_automation_rule_id,$4,$5,$1,$2,$6::jsonb
     FROM whatsapp_automation_rules rule
     JOIN whatsapp_templates template ON template.whatsapp_template_id=rule.whatsapp_template_id
     JOIN whatsapp_connections connection ON connection.whatsapp_connection_id=rule.whatsapp_connection_id
     WHERE rule.company_id=$1 AND rule.project_id=$2
       AND rule.trigger_activity_type=$3 AND rule.is_active=TRUE
       AND template.status='APPROVED' AND connection.status='connected'`,
    [input.companyId, input.projectId, input.eventName, leadId, contactId, JSON.stringify(input.context ?? {})],
  );
  return result.rowCount ?? 0;
}
