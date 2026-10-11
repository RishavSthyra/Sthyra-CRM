import type { Pool, PoolClient } from "pg";
import type { BulkTransferInput } from "@/lib/bulkTransfers";
import type { LeadVisibility } from "@/lib/leadVisibility";
import { validateTransferReferences } from "@/lib/transfers";

type Queryable = Pick<Pool | PoolClient, "query">;

export type BulkTransferLead = {
  lead_id: string;
  subject_name: string;
  email: string | null;
  status: string;
  current_owner_user_id: string | null;
  current_team_id: string | null;
};

export type BlockedBulkTransferLead = {
  lead_id: string;
  subject_name: string;
  reason: string;
};

export type BulkChecklistItem = {
  item_id: string;
  label: string;
  description: string | null;
  position: number;
  is_required: boolean;
};

export type BulkTransferPreparation = {
  templateId: string | null;
  checklistItems: BulkChecklistItem[];
  eligible: BulkTransferLead[];
  blocked: BlockedBulkTransferLead[];
  referenceErrors: string[];
};

export async function prepareBulkTransfer(
  db: Queryable,
  input: BulkTransferInput,
  visibility: LeadVisibility,
  lock: boolean,
): Promise<BulkTransferPreparation> {
  let templateId = input.checklist_template_id ?? null;
  if (!templateId) {
    const template = await db.query<{ template_id: string }>(
      `SELECT template_id FROM transfer_checklist_templates
       WHERE company_id=(SELECT company_id FROM projects WHERE project_id=$1)
         AND is_active=TRUE AND (project_id=$1 OR project_id IS NULL)
         AND applies_to IN ('lead','both')
       ORDER BY (project_id IS NOT NULL) DESC, updated_at DESC LIMIT 1`,
      [input.project_id],
    );
    templateId = template.rows[0]?.template_id ?? null;
  }

  const project = await db.query<{ company_id: number }>(
    "SELECT company_id FROM projects WHERE project_id=$1",
    [input.project_id],
  );
  const companyId = Number(project.rows[0]?.company_id ?? 0);
  const referenceErrors = companyId
    ? await validateTransferReferences(db, companyId, input.project_id, {
        to_owner_user_id: input.to_owner_user_id,
        to_team_id: input.to_team_id,
        checklist_template_id: templateId,
        expires_at: input.expires_at,
      })
    : ["Project not found"];

  const checklistItems = templateId
    ? await db.query<BulkChecklistItem>(
        `SELECT item_id, label, description, position, is_required
         FROM transfer_checklist_template_items
         WHERE template_id=$1 ORDER BY position`,
        [templateId],
      )
    : { rows: [] as BulkChecklistItem[] };

  const leads = await db.query<
    BulkTransferLead & {
      active_transfer_id: string | null;
      active_transfer_status: string | null;
    }
  >(
    `SELECT lead.lead_id,
       COALESCE(
         NULLIF(BTRIM(CONCAT_WS(' ', contact.first_name, contact.last_name)), ''),
         NULLIF(BTRIM(contact.email), ''),
         NULLIF(BTRIM(contact.phone_number), ''),
         'Lead'
       ) AS subject_name,
       contact.email, lead.status, lead.current_owner_user_id,
       lead.current_team_id, active_transfer.transfer_id AS active_transfer_id,
       active_transfer.status AS active_transfer_status
     FROM leads lead
     JOIN contacts contact ON contact.contact_id=lead.contact_id
     LEFT JOIN LATERAL (
       SELECT transfer_id, status FROM transfers
       WHERE lead_id=lead.lead_id AND status IN ('draft','validated','submitted')
       LIMIT 1
     ) active_transfer ON TRUE
     WHERE lead.lead_id=ANY($1::uuid[]) AND lead.project_id=$2
     ${lock ? "FOR UPDATE OF lead" : ""}`,
    [input.lead_ids, input.project_id],
  );
  const byId = new Map(leads.rows.map((lead) => [lead.lead_id, lead]));
  const eligible: BulkTransferLead[] = [];
  const blocked: BlockedBulkTransferLead[] = [];

  for (const leadId of input.lead_ids) {
    const lead = byId.get(leadId);
    let reason: string | null = null;
    if (!lead) reason = "Lead was not found in this project";
    else if (!["active", "nurture"].includes(lead.status))
      reason = `A ${lead.status} lead cannot be transferred`;
    else if (
      !visibility.canViewProjectWide &&
      lead.current_owner_user_id !== visibility.userId &&
      lead.current_team_id !== visibility.teamId
    )
      reason = "You no longer have permission to transfer this lead";
    else if (lead.active_transfer_id)
      reason = `An active ${lead.active_transfer_status} transfer already exists`;
    else if (
      lead.current_owner_user_id === input.to_owner_user_id &&
      lead.current_team_id === input.to_team_id
    )
      reason = "The selected recipient already owns this lead";

    if (reason) {
      blocked.push({
        lead_id: leadId,
        subject_name: lead?.subject_name ?? "Unavailable lead",
        reason,
      });
    } else if (lead) {
      eligible.push({
        lead_id: lead.lead_id,
        subject_name: lead.subject_name,
        email: lead.email,
        status: lead.status,
        current_owner_user_id: lead.current_owner_user_id,
        current_team_id: lead.current_team_id,
      });
    }
  }

  return {
    templateId,
    checklistItems: checklistItems.rows,
    eligible,
    blocked,
    referenceErrors,
  };
}
