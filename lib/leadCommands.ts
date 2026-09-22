import type { PoolClient } from "pg";
import { addLeadHistory } from "@/lib/leads";
import { isObject } from "@/utils/isObject";

export async function lockLead(
  client: PoolClient,
  leadId: string,
): Promise<Record<string, unknown> | null> {
  const result = await client.query(
    "SELECT * FROM leads WHERE lead_id=$1 FOR UPDATE",
    [leadId],
  );
  return result.rows[0] ?? null;
}

export async function getProjectStage(
  client: PoolClient,
  projectId: number,
  stageKey: string,
): Promise<Record<string, unknown> | null> {
  const result = await client.query(
    `SELECT stage_id, stage_key, stage_name, is_initial, is_terminal
     FROM project_lead_stages
     WHERE project_id=$1 AND stage_key=$2 AND is_active=TRUE`,
    [projectId, stageKey.toLowerCase()],
  );
  return result.rows[0] ?? null;
}

export async function transitionLead(
  client: PoolClient,
  lead: Record<string, unknown>,
  command: string,
  toStatus: string,
  toStageId: string | null,
  updates: Record<string, unknown>,
  metadata: Record<string, unknown> = {},
  performedBy: string | null = null,
): Promise<Record<string, unknown>> {
  const safeFields = new Set([
    "closing_reason_id",
    "closing_notes",
    "duplicate_of_lead_id",
    "invalid_reason",
    "nurture_reason",
    "nurture_until",
    "qualification_data",
    "qualified_at",
    "closed_at",
  ]);
  const entries = Object.entries(updates).filter(([field]) =>
    safeFields.has(field),
  );
  const values: unknown[] = [toStatus, toStageId];
  const assignments = ["status=$1", "stage_id=$2"];
  for (const [field, value] of entries) {
    values.push(field === "qualification_data" ? JSON.stringify(value) : value);
    assignments.push(
      `${field}=$${values.length}${field === "qualification_data" ? "::jsonb" : ""}`,
    );
  }
  values.push(lead.lead_id);
  const result = await client.query(
    `UPDATE leads SET ${assignments.join(", ")}, updated_at=CURRENT_TIMESTAMP
     WHERE lead_id=$${values.length} RETURNING *`,
    values,
  );
  await addLeadHistory(
    client,
    lead,
    command,
    toStatus,
    toStageId,
    metadata,
    performedBy,
  );
  return result.rows[0];
}

export async function validateQualificationValues(
  client: PoolClient,
  projectId: number,
  value: unknown,
): Promise<string[]> {
  if (!isObject(value) || Array.isArray(value)) {
    return ["qualification_data must be a JSON object"];
  }
  const definitions = await client.query(
    `SELECT field_key, field_type, is_required, options
     FROM project_qualification_fields
     WHERE project_id=$1 AND is_active=TRUE`,
    [projectId],
  );
  const errors: string[] = [];
  const known = new Set(
    definitions.rows.map((field) => field.field_key as string),
  );
  for (const key of Object.keys(value)) {
    if (!known.has(key)) {
      errors.push(`Unknown qualification field: ${key}`);
    }
  }
  for (const definition of definitions.rows) {
    const fieldValue = value[definition.field_key];
    if (
      definition.is_required &&
      (fieldValue === undefined || fieldValue === null || fieldValue === "")
    ) {
      errors.push(`${definition.field_key} is required`);
      continue;
    }
    if (fieldValue === undefined || fieldValue === null) {
      continue;
    }
    const type = definition.field_type as string;
    const valid =
      (type === "text" && typeof fieldValue === "string") ||
      (type === "number" &&
        typeof fieldValue === "number" &&
        Number.isFinite(fieldValue)) ||
      (type === "boolean" && typeof fieldValue === "boolean") ||
      (type === "date" &&
        typeof fieldValue === "string" &&
        /^\d{4}-\d{2}-\d{2}$/.test(fieldValue)) ||
      (type === "single_select" &&
        typeof fieldValue === "string" &&
        definition.options.includes(fieldValue)) ||
      (type === "multi_select" &&
        Array.isArray(fieldValue) &&
        fieldValue.every(
          (item) =>
            typeof item === "string" && definition.options.includes(item),
        ));
    if (!valid) {
      errors.push(
        `${definition.field_key} has an invalid value for type ${type}`,
      );
    }
  }
  return errors;
}
