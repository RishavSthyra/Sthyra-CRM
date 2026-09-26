import type { Pool, PoolClient } from "pg";
import { addOpportunityOwnershipHistory } from "@/lib/opportunities";
import { parseUuid } from "@/lib/operations";
import { addOwnershipHistory } from "@/lib/leadHistory";
import { isObject } from "@/utils/isObject";
import { validateText } from "@/utils/validateText";

type Queryable = Pick<Pool | PoolClient, "query">;
type ValidationResult<T> =
  | { ok: true; data: T }
  | { ok: false; errors: string[] };

export const TRANSFER_COLUMNS = `
  tr.transfer_id, tr.company_id, tr.project_id, tr.subject_type,
  tr.lead_id, tr.opportunity_id, tr.from_owner_user_id, tr.from_team_id,
  tr.to_owner_user_id, tr.to_team_id, tr.checklist_template_id,
  tr.status, tr.reason, tr.notes, tr.rejection_reason,
  tr.validation_errors, tr.requested_by, tr.validated_by, tr.decided_by,
  tr.validated_at, tr.submitted_at, tr.accepted_at, tr.rejected_at,
  tr.cancelled_at, tr.expired_at, tr.force_assigned_at, tr.expires_at,
  tr.created_at, tr.updated_at
`;

export type TransferInput = {
  lead_id?: string;
  opportunity_id?: string;
  to_owner_user_id?: string | null;
  to_team_id?: string | null;
  checklist_template_id?: string | null;
  reason?: string | null;
  notes?: string | null;
  expires_at?: string | null;
};

function uuid(
  value: unknown,
  field: string,
  nullable: boolean,
  errors: string[],
): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null && nullable) return null;
  if (typeof value !== "string") {
    errors.push(`${field} must be a valid UUID${nullable ? " or null" : ""}`);
    return undefined;
  }
  const parsed = parseUuid(value);
  if (!parsed) {
    errors.push(`${field} must be a valid UUID${nullable ? " or null" : ""}`);
    return undefined;
  }
  return parsed;
}

function dateTime(
  value: unknown,
  field: string,
  errors: string[],
): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (
    typeof value !== "string" ||
    !value.trim() ||
    Number.isNaN(Date.parse(value))
  ) {
    errors.push(`${field} must be a valid ISO date-time or null`);
    return undefined;
  }
  return new Date(value).toISOString();
}

export function validateTransferPayload(
  body: unknown,
  partial: boolean,
): ValidationResult<TransferInput> {
  if (!isObject(body) || Array.isArray(body))
    return { ok: false, errors: ["Request body must be a JSON object"] };
  const allowed = new Set([
    "lead_id",
    "opportunity_id",
    "to_owner_user_id",
    "to_team_id",
    "checklist_template_id",
    "reason",
    "notes",
    "expires_at",
  ]);
  const errors = Object.keys(body)
    .filter((key) => !allowed.has(key))
    .map((key) => `Unknown field: ${key}`);
  const leadId = uuid(body.lead_id, "lead_id", false, errors) ?? undefined;
  const opportunityId =
    uuid(body.opportunity_id, "opportunity_id", false, errors) ?? undefined;
  const targetUser = uuid(
    body.to_owner_user_id,
    "to_owner_user_id",
    true,
    errors,
  );
  const targetTeam = uuid(body.to_team_id, "to_team_id", true, errors);
  const templateId = uuid(
    body.checklist_template_id,
    "checklist_template_id",
    true,
    errors,
  );
  const reason = validateText(body.reason, "reason", 5000, true, errors);
  const notes = validateText(body.notes, "notes", 10000, true, errors);
  const expiresAt = dateTime(body.expires_at, "expires_at", errors);

  if (!partial) {
    if (Number(Boolean(leadId)) + Number(Boolean(opportunityId)) !== 1)
      errors.push("Exactly one of lead_id or opportunity_id is required");
    if (Number(Boolean(targetUser)) + Number(Boolean(targetTeam)) !== 1)
      errors.push("Exactly one transfer recipient is required");
  } else {
    if (!Object.keys(body).length) errors.push("At least one field is required");
    if (body.lead_id !== undefined || body.opportunity_id !== undefined)
      errors.push("The transfer subject cannot be changed");
    if (
      (body.to_owner_user_id !== undefined || body.to_team_id !== undefined) &&
      Number(Boolean(targetUser)) + Number(Boolean(targetTeam)) !== 1
    )
      errors.push("Exactly one transfer recipient is required");
  }

  return errors.length
    ? { ok: false, errors }
    : {
        ok: true,
        data: {
          lead_id: leadId,
          opportunity_id: opportunityId,
          to_owner_user_id: targetUser,
          to_team_id: targetTeam,
          checklist_template_id: templateId,
          reason,
          notes,
          expires_at: expiresAt,
        },
      };
}

export type TransferSubject = Record<string, unknown> & {
  subject_type: "lead" | "opportunity";
  subject_id: string;
  company_id: number;
  project_id: number;
  current_owner_user_id: string | null;
  current_team_id: string | null;
};

export async function getTransferSubject(
  client: Queryable,
  input: Pick<TransferInput, "lead_id" | "opportunity_id">,
  lock = false,
): Promise<TransferSubject | null> {
  if (input.lead_id) {
    const result = await client.query(
      `SELECT l.*, p.company_id, 'lead'::text AS subject_type,
              l.lead_id AS subject_id
       FROM leads l JOIN projects p ON p.project_id=l.project_id
       WHERE l.lead_id=$1${lock ? " FOR UPDATE OF l" : ""}`,
      [input.lead_id],
    );
    return (result.rows[0] as TransferSubject | undefined) ?? null;
  }
  if (input.opportunity_id) {
    const result = await client.query(
      `SELECT o.*, 'opportunity'::text AS subject_type,
              o.opportunity_id AS subject_id
       FROM opportunities o WHERE o.opportunity_id=$1${lock ? " FOR UPDATE" : ""}`,
      [input.opportunity_id],
    );
    return (result.rows[0] as TransferSubject | undefined) ?? null;
  }
  return null;
}

export async function getTransfer(
  client: Queryable,
  transferId: string,
  lock = false,
): Promise<Record<string, unknown> | null> {
  const result = await client.query(
    `SELECT * FROM transfers WHERE transfer_id=$1${lock ? " FOR UPDATE" : ""}`,
    [transferId],
  );
  return result.rows[0] ?? null;
}

export async function validateTransferReferences(
  client: Queryable,
  companyId: number,
  projectId: number,
  input: TransferInput,
): Promise<string[]> {
  const errors: string[] = [];
  if (input.to_owner_user_id) {
    const user = await client.query(
      `SELECT 1 FROM users u
       JOIN teams t ON t.team_id=u.team_id
       JOIN roles r ON r.role_id=u.role_id
       WHERE u.user_id=$1 AND t.company_id=$2 AND u.is_active=TRUE
         AND u.deleted_at IS NULL AND t.is_active=TRUE AND r.is_active=TRUE
         AND (
           r.role_key IN ('COMPANY_OWNER','COMPANY_ADMIN','SUPER_ADMIN')
           OR EXISTS (SELECT 1 FROM user_projects up WHERE up.user_id=u.user_id AND up.project_id=$3)
           OR EXISTS (SELECT 1 FROM team_projects tp WHERE tp.team_id=u.team_id AND tp.project_id=$3)
         )`,
      [input.to_owner_user_id, companyId, projectId],
    );
    if (!user.rowCount)
      errors.push("to_owner_user_id is not an eligible active project user");
  }
  if (input.to_team_id) {
    const team = await client.query(
      `SELECT 1 FROM teams t WHERE t.team_id=$1 AND t.company_id=$2
       AND t.is_active=TRUE AND EXISTS (
         SELECT 1 FROM team_projects tp WHERE tp.team_id=t.team_id AND tp.project_id=$3
       )`,
      [input.to_team_id, companyId, projectId],
    );
    if (!team.rowCount)
      errors.push("to_team_id is not an eligible active project team");
  }
  if (input.checklist_template_id) {
    const template = await client.query(
      `SELECT 1 FROM transfer_checklist_templates
       WHERE template_id=$1 AND company_id=$2 AND is_active=TRUE
         AND (project_id IS NULL OR project_id=$3)`,
      [input.checklist_template_id, companyId, projectId],
    );
    if (!template.rowCount)
      errors.push("checklist_template_id is not an active applicable template");
  }
  if (input.expires_at && Date.parse(input.expires_at) <= Date.now())
    errors.push("expires_at must be in the future");
  return errors;
}

export async function copyTransferChecklist(
  client: PoolClient,
  transferId: string,
  templateId: string | null,
): Promise<void> {
  await client.query("DELETE FROM transfer_checklist_items WHERE transfer_id=$1", [transferId]);
  if (!templateId) return;
  await client.query(
    `INSERT INTO transfer_checklist_items (
       transfer_id, template_item_id, label, description, position, is_required
     )
     SELECT $1, item_id, label, description, position, is_required
     FROM transfer_checklist_template_items WHERE template_id=$2
     ORDER BY position`,
    [transferId, templateId],
  );
}

export async function addTransferHistory(
  client: PoolClient,
  transfer: Record<string, unknown>,
  action: string,
  toStatus: string,
  performedBy: string,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  await client.query(
    `INSERT INTO transfer_history (
       transfer_id, action, from_status, to_status, metadata, performed_by
     ) VALUES ($1,$2,$3,$4,$5::jsonb,$6)`,
    [
      transfer.transfer_id,
      action,
      transfer.status,
      toStatus,
      JSON.stringify(metadata),
      performedBy,
    ],
  );
}

export async function getTransferValidationErrors(
  client: Queryable,
  transfer: Record<string, unknown>,
): Promise<string[]> {
  const errors = await validateTransferReferences(
    client,
    Number(transfer.company_id),
    Number(transfer.project_id),
    {
      to_owner_user_id: (transfer.to_owner_user_id as string | null) ?? null,
      to_team_id: (transfer.to_team_id as string | null) ?? null,
      checklist_template_id:
        (transfer.checklist_template_id as string | null) ?? null,
      expires_at: (transfer.expires_at as string | null) ?? null,
    },
  );
  const subject = await getTransferSubject(client, {
    lead_id: (transfer.lead_id as string | null) ?? undefined,
    opportunity_id:
      (transfer.opportunity_id as string | null) ?? undefined,
  });
  if (!subject) errors.push("Transfer subject no longer exists");
  else {
    if (
      subject.current_owner_user_id !== transfer.from_owner_user_id ||
      subject.current_team_id !== transfer.from_team_id
    )
      errors.push("The subject owner changed after this transfer was created");
    if (
      subject.current_owner_user_id === transfer.to_owner_user_id &&
      subject.current_team_id === transfer.to_team_id
    )
      errors.push("The transfer recipient already owns this record");
    if (subject.subject_type === "lead" && ["closed", "duplicate", "invalid"].includes(String(subject.status)))
      errors.push(`A ${String(subject.status)} lead cannot be transferred`);
    if (subject.subject_type === "opportunity" && subject.status === "closed")
      errors.push("A closed opportunity cannot be transferred");
  }
  return errors;
}

export async function incompleteRequiredChecklistCount(
  client: Queryable,
  transferId: string,
): Promise<number> {
  const result = await client.query(
    `SELECT COUNT(*)::integer AS total FROM transfer_checklist_items
     WHERE transfer_id=$1 AND is_required=TRUE AND is_completed=FALSE`,
    [transferId],
  );
  return Number(result.rows[0]?.total ?? 0);
}

export async function applyTransferOwnership(
  client: PoolClient,
  transfer: Record<string, unknown>,
  performedBy: string,
): Promise<void> {
  const nextOwner = (transfer.to_owner_user_id as string | null) ?? null;
  const nextTeam = (transfer.to_team_id as string | null) ?? null;
  if (transfer.subject_type === "lead") {
    const current = await client.query(
      "SELECT * FROM leads WHERE lead_id=$1 FOR UPDATE",
      [transfer.lead_id],
    );
    if (!current.rowCount) throw new Error("Transfer subject no longer exists");
    const lead = current.rows[0];
    await client.query(
      `UPDATE leads SET current_owner_user_id=$1, current_team_id=$2,
       assigned_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP WHERE lead_id=$3`,
      [nextOwner, nextTeam, transfer.lead_id],
    );
    await addOwnershipHistory(
      client,
      transfer.lead_id as string,
      {
        current_owner_user_id: lead.current_owner_user_id,
        current_team_id: lead.current_team_id,
      },
      { current_owner_user_id: nextOwner, current_team_id: nextTeam },
      performedBy,
    );
  } else {
    const current = await client.query(
      "SELECT * FROM opportunities WHERE opportunity_id=$1 FOR UPDATE",
      [transfer.opportunity_id],
    );
    if (!current.rowCount) throw new Error("Transfer subject no longer exists");
    const opportunity = current.rows[0];
    await client.query(
      `UPDATE opportunities SET current_owner_user_id=$1, current_team_id=$2,
       updated_by=$3, updated_at=CURRENT_TIMESTAMP WHERE opportunity_id=$4`,
      [nextOwner, nextTeam, performedBy, transfer.opportunity_id],
    );
    await addOpportunityOwnershipHistory(
      client,
      transfer.opportunity_id as string,
      {
        owner: opportunity.current_owner_user_id,
        team: opportunity.current_team_id,
      },
      { owner: nextOwner, team: nextTeam },
      performedBy,
    );
  }
}

export type TransferTemplateInput = {
  project_id?: number | null;
  template_name?: string;
  description?: string | null;
  applies_to?: "lead" | "opportunity" | "both";
};

export function validateTransferTemplate(
  body: unknown,
  partial: boolean,
): ValidationResult<TransferTemplateInput> {
  if (!isObject(body) || Array.isArray(body))
    return { ok: false, errors: ["Request body must be a JSON object"] };
  const allowed = new Set(["project_id", "template_name", "description", "applies_to"]);
  const errors = Object.keys(body)
    .filter((key) => !allowed.has(key))
    .map((key) => `Unknown field: ${key}`);
  let projectId: number | null | undefined;
  if (body.project_id === null) projectId = null;
  else if (body.project_id !== undefined) {
    if (!Number.isSafeInteger(body.project_id) || Number(body.project_id) <= 0)
      errors.push("project_id must be a positive integer or null");
    else projectId = Number(body.project_id);
  }
  const name = validateText(body.template_name, "template_name", 150, false, errors);
  const description = validateText(body.description, "description", 5000, true, errors);
  const appliesTo = body.applies_to;
  if (appliesTo !== undefined && !["lead", "opportunity", "both"].includes(String(appliesTo)))
    errors.push("applies_to must be lead, opportunity, or both");
  if (!partial) {
    if (!name) errors.push("template_name is required");
  } else if (!Object.keys(body).length) errors.push("At least one field is required");
  return errors.length
    ? { ok: false, errors }
    : {
        ok: true,
        data: {
          project_id: projectId,
          template_name: name ?? undefined,
          description,
          applies_to: appliesTo as TransferTemplateInput["applies_to"],
        },
      };
}

export type TemplateItemInput = {
  item_id?: string;
  label: string;
  description: string | null;
  position: number;
  is_required: boolean;
};

export function validateTemplateItems(body: unknown): ValidationResult<TemplateItemInput[]> {
  if (!isObject(body) || Array.isArray(body) || !Array.isArray(body.items))
    return { ok: false, errors: ["items must be an array"] };
  const rootUnknown = Object.keys(body).filter((key) => key !== "items");
  const errors = rootUnknown.map((key) => `Unknown field: ${key}`);
  const items: TemplateItemInput[] = [];
  body.items.forEach((raw, index) => {
    if (!isObject(raw) || Array.isArray(raw)) {
      errors.push(`items[${index}] must be an object`);
      return;
    }
    const unknown = Object.keys(raw).filter(
      (key) => !["item_id", "label", "description", "position", "is_required"].includes(key),
    );
    unknown.forEach((key) => errors.push(`items[${index}].${key} is unknown`));
    const itemErrors: string[] = [];
    const itemId = uuid(raw.item_id, `items[${index}].item_id`, false, itemErrors) ?? undefined;
    const label = validateText(raw.label, `items[${index}].label`, 250, false, itemErrors);
    const description = validateText(raw.description, `items[${index}].description`, 5000, true, itemErrors);
    const position = raw.position ?? index + 1;
    if (!Number.isSafeInteger(position) || Number(position) <= 0)
      itemErrors.push(`items[${index}].position must be a positive integer`);
    const required = raw.is_required ?? true;
    if (typeof required !== "boolean") itemErrors.push(`items[${index}].is_required must be boolean`);
    errors.push(...itemErrors);
    if (!itemErrors.length)
      items.push({ item_id: itemId, label: label as string, description: description ?? null, position: Number(position), is_required: required as boolean });
  });
  if (new Set(items.map((item) => item.position)).size !== items.length)
    errors.push("Item positions must be unique");
  return errors.length ? { ok: false, errors } : { ok: true, data: items };
}
