import { parseUuid } from "@/lib/operations";
import { isObject } from "@/utils/isObject";
import { validateText } from "@/utils/validateText";

export const MAX_BULK_TRANSFER_LEADS = 100;

export type BulkTransferInput = {
  project_id: number;
  lead_ids: string[];
  to_owner_user_id?: string | null;
  to_team_id?: string | null;
  checklist_template_id?: string | null;
  reason: string;
  notes?: string | null;
  expires_at?: string | null;
  confirmed_checklist_item_ids: string[];
};

type ValidationResult =
  | { ok: true; data: BulkTransferInput }
  | { ok: false; errors: string[] };

function optionalUuid(
  value: unknown,
  field: string,
  errors: string[],
): string | null | undefined {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") {
    errors.push(`${field} must be a valid UUID or null`);
    return undefined;
  }
  const parsed = parseUuid(value);
  if (!parsed) errors.push(`${field} must be a valid UUID or null`);
  return parsed ?? undefined;
}

function uuidList(
  value: unknown,
  field: string,
  errors: string[],
  required: boolean,
) {
  if (value === undefined && !required) return [];
  if (!Array.isArray(value)) {
    errors.push(`${field} must be an array of UUIDs`);
    return [];
  }
  const parsed: string[] = [];
  value.forEach((item, index) => {
    const id = typeof item === "string" ? parseUuid(item) : null;
    if (!id) errors.push(`${field}[${index}] must be a valid UUID`);
    else parsed.push(id);
  });
  return [...new Set(parsed)];
}

export function validateBulkTransferPayload(body: unknown): ValidationResult {
  if (!isObject(body) || Array.isArray(body))
    return { ok: false, errors: ["Request body must be a JSON object"] };

  const allowed = new Set([
    "project_id",
    "lead_ids",
    "to_owner_user_id",
    "to_team_id",
    "checklist_template_id",
    "reason",
    "notes",
    "expires_at",
    "confirmed_checklist_item_ids",
  ]);
  const errors = Object.keys(body)
    .filter((key) => !allowed.has(key))
    .map((key) => `Unknown field: ${key}`);

  const projectId = Number(body.project_id);
  if (!Number.isSafeInteger(projectId) || projectId <= 0)
    errors.push("project_id must be a positive integer");

  const leadIds = uuidList(body.lead_ids, "lead_ids", errors, true);
  if (leadIds.length < 2)
    errors.push("Select at least two unique leads for a bulk transfer");
  if (leadIds.length > MAX_BULK_TRANSFER_LEADS)
    errors.push(
      `A bulk transfer can contain at most ${MAX_BULK_TRANSFER_LEADS} leads`,
    );

  const targetUser = optionalUuid(
    body.to_owner_user_id,
    "to_owner_user_id",
    errors,
  );
  const targetTeam = optionalUuid(body.to_team_id, "to_team_id", errors);
  if (Number(Boolean(targetUser)) + Number(Boolean(targetTeam)) !== 1)
    errors.push("Exactly one transfer recipient is required");

  const templateId = optionalUuid(
    body.checklist_template_id,
    "checklist_template_id",
    errors,
  );
  const reason = validateText(body.reason, "reason", 5000, false, errors);
  if (!reason) errors.push("reason is required");
  const notes = validateText(body.notes, "notes", 10000, true, errors);

  let expiresAt: string | null = null;
  if (body.expires_at !== undefined && body.expires_at !== null) {
    if (
      typeof body.expires_at !== "string" ||
      !body.expires_at.trim() ||
      Number.isNaN(Date.parse(body.expires_at))
    )
      errors.push("expires_at must be a valid ISO date-time or null");
    else expiresAt = new Date(body.expires_at).toISOString();
  }

  const confirmedChecklistItemIds = uuidList(
    body.confirmed_checklist_item_ids,
    "confirmed_checklist_item_ids",
    errors,
    false,
  );

  return errors.length
    ? { ok: false, errors }
    : {
        ok: true,
        data: {
          project_id: projectId,
          lead_ids: leadIds,
          to_owner_user_id: targetUser ?? null,
          to_team_id: targetTeam ?? null,
          checklist_template_id: templateId ?? null,
          reason: reason!,
          notes: notes ?? null,
          expires_at: expiresAt,
          confirmed_checklist_item_ids: confirmedChecklistItemIds,
        },
      };
}

export function missingRequiredChecklistItems(
  requiredItemIds: readonly string[],
  confirmedItemIds: readonly string[],
) {
  const confirmed = new Set(confirmedItemIds);
  return requiredItemIds.filter((itemId) => !confirmed.has(itemId));
}
