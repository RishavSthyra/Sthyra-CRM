import type { PoolClient } from "pg";
import { startSlaInstancesForLead } from "@/lib/assignmentService";
import { addOwnershipHistory } from "@/lib/leadHistory";
import { isUuid } from "@/lib/permissions";
import { applyRoutingForLead } from "@/lib/routingService";
import { isObject } from "@/utils/isObject";
import { validateText } from "@/utils/validateText";

export const LEAD_COLUMNS = `
  lead_id,
  contact_id,
  project_id,
  source_id,
  campaign_id,
  intake_event_id,
  stage_id,
  status,
  sub_source,
  temperature,
  customer_type,
  current_owner_user_id,
  current_team_id,
  preferred_location,
  preferred_config,
  preferred_facing,
  preferred_floor,
  preferred_view,
  budget,
  buying_reason,
  qualification_data,
  closing_reason_id,
  closing_notes,
  duplicate_of_lead_id,
  invalid_reason,
  nurture_reason,
  nurture_until,
  received_at,
  assigned_at,
  qualified_at,
  closed_at,
  created_at,
  updated_at
`;

const WRITE_FIELDS = [
  "contact_id",
  "project_id",
  "source_id",
  "campaign_id",
  "sub_source",
  "temperature",
  "customer_type",
  "current_owner_user_id",
  "current_team_id",
  "preferred_location",
  "preferred_config",
  "preferred_facing",
  "preferred_floor",
  "preferred_view",
  "budget",
  "buying_reason",
  "qualification_data",
  "tag_ids",
] as const;

export type LeadWrite = Partial<{
  contact_id: string;
  project_id: number;
  source_id: string | null;
  campaign_id: string | null;
  sub_source: string | null;
  temperature: "cold" | "warm" | "hot" | null;
  customer_type: string | null;
  current_owner_user_id: string | null;
  current_team_id: string | null;
  preferred_location: string | null;
  preferred_config: string | null;
  preferred_facing: string | null;
  preferred_floor: string | null;
  preferred_view: string | null;
  budget: number | null;
  buying_reason: string | null;
  qualification_data: Record<string, unknown>;
  tag_ids: string[];
}>;

type ValidationResult =
  { ok: true; data: LeadWrite } | { ok: false; errors: string[] };

function validateUuidField(
  value: unknown,
  field: string,
  nullable: boolean,
  errors: string[],
): string | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null && nullable) {
    return null;
  }
  if (!isUuid(value)) {
    errors.push(`${field} must be a valid UUID${nullable ? " or null" : ""}`);
    return undefined;
  }
  return value.toLowerCase();
}

export function validateLeadPayload(
  body: unknown,
  options: { partial: boolean },
): ValidationResult {
  if (!isObject(body) || Array.isArray(body)) {
    return { ok: false, errors: ["Request body must be a JSON object"] };
  }
  const allowed = new Set<string>(WRITE_FIELDS);
  const errors = Object.keys(body)
    .filter((field) => !allowed.has(field))
    .map((field) => `Unknown field: ${field}`);
  const data: LeadWrite = {};

  const contactId = validateUuidField(
    body.contact_id,
    "contact_id",
    false,
    errors,
  );
  if (typeof contactId === "string") {
    data.contact_id = contactId;
  }
  if (body.project_id !== undefined) {
    if (
      !Number.isSafeInteger(body.project_id) ||
      (body.project_id as number) <= 0
    ) {
      errors.push("project_id must be a positive integer");
    } else {
      data.project_id = body.project_id as number;
    }
  }
  for (const field of [
    "source_id",
    "campaign_id",
    "current_owner_user_id",
    "current_team_id",
  ] as const) {
    const value = validateUuidField(body[field], field, true, errors);
    if (value !== undefined) {
      data[field] = value;
    }
  }
  for (const [field, max] of [
    ["sub_source", 150],
    ["customer_type", 50],
    ["preferred_location", 200],
    ["preferred_config", 100],
    ["preferred_facing", 100],
    ["preferred_floor", 100],
    ["preferred_view", 100],
    ["buying_reason", 5000],
  ] as const) {
    const value = validateText(body[field], field, max, true, errors);
    if (value !== undefined) {
      data[field] = value;
    }
  }
  if (body.temperature !== undefined) {
    if (body.temperature === null) {
      data.temperature = null;
    } else if (!["cold", "warm", "hot"].includes(body.temperature as string)) {
      errors.push("temperature must be cold, warm, hot, or null");
    } else {
      data.temperature = body.temperature as LeadWrite["temperature"];
    }
  }
  if (body.budget !== undefined) {
    if (body.budget === null) {
      data.budget = null;
    } else if (
      typeof body.budget !== "number" ||
      !Number.isFinite(body.budget) ||
      body.budget < 0
    ) {
      errors.push("budget must be a non-negative finite number or null");
    } else {
      data.budget = body.budget;
    }
  }
  if (body.qualification_data !== undefined) {
    if (
      !isObject(body.qualification_data) ||
      Array.isArray(body.qualification_data)
    ) {
      errors.push("qualification_data must be a JSON object");
    } else {
      data.qualification_data = body.qualification_data;
    }
  }
  if (body.tag_ids !== undefined) {
    if (
      !Array.isArray(body.tag_ids) ||
      body.tag_ids.some((value) => !isUuid(value))
    ) {
      errors.push("tag_ids must be an array of UUIDs");
    } else {
      data.tag_ids = [
        ...new Set(body.tag_ids.map((value) => value.toLowerCase())),
      ];
    }
  }

  if (!options.partial) {
    if (body.contact_id === undefined) {
      errors.push("contact_id is required");
    }
    if (body.project_id === undefined) {
      errors.push("project_id is required");
    }
  } else if (Object.keys(body).length === 0) {
    errors.push("At least one field is required");
  }
  return errors.length ? { ok: false, errors } : { ok: true, data };
}

export function parseLeadId(value: string): string | null {
  return isUuid(value) ? value.toLowerCase() : null;
}

export class LeadReferenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LeadReferenceError";
  }
}

export async function addLeadHistory(
  client: PoolClient,
  lead: Record<string, unknown>,
  command: string,
  toStatus: string,
  toStageId: string | null,
  metadata: Record<string, unknown> = {},
  performedBy: string | null = null,
): Promise<void> {
  await client.query(
    `INSERT INTO lead_state_history (
       lead_id, command, from_status, to_status, from_stage_id,
       to_stage_id, metadata, performed_by
     ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8)`,
    [
      lead.lead_id,
      command,
      lead.status ?? null,
      toStatus,
      lead.stage_id ?? null,
      toStageId,
      JSON.stringify(metadata),
      performedBy,
    ],
  );
}

async function ensureReferences(
  client: PoolClient,
  lead: LeadWrite,
): Promise<string> {
  const project = await client.query(
    "SELECT project_id FROM projects WHERE project_id=$1 AND is_active=TRUE",
    [lead.project_id],
  );
  if (!project.rowCount) {
    throw new LeadReferenceError("Active project not found");
  }
  const contact = await client.query(
    `SELECT contact_id FROM contacts
     WHERE contact_id=$1 AND archived_at IS NULL AND merged_into_contact_id IS NULL`,
    [lead.contact_id],
  );
  if (!contact.rowCount) {
    throw new LeadReferenceError("Active contact not found");
  }
  if (lead.source_id) {
    const source = await client.query(
      "SELECT source_id FROM lead_sources WHERE source_id=$1 AND is_active=TRUE",
      [lead.source_id],
    );
    if (!source.rowCount) {
      throw new LeadReferenceError("Active lead source not found");
    }
  }
  if (lead.campaign_id) {
    const campaign = await client.query(
      "SELECT source_id FROM campaigns WHERE campaign_id=$1 AND is_active=TRUE",
      [lead.campaign_id],
    );
    if (!campaign.rowCount) {
      throw new LeadReferenceError("Active campaign not found");
    }
    if (
      lead.source_id &&
      campaign.rows[0].source_id &&
      campaign.rows[0].source_id !== lead.source_id
    ) {
      throw new LeadReferenceError(
        "Campaign does not belong to the selected lead source",
      );
    }
  }
  if (lead.current_owner_user_id) {
    const user = await client.query(
      "SELECT user_id FROM users WHERE user_id=$1 AND is_active=TRUE AND deleted_at IS NULL",
      [lead.current_owner_user_id],
    );
    if (!user.rowCount) {
      throw new LeadReferenceError("Active lead owner not found");
    }
  }
  if (lead.current_team_id) {
    const team = await client.query(
      "SELECT team_id FROM teams WHERE team_id=$1 AND is_active=TRUE",
      [lead.current_team_id],
    );
    if (!team.rowCount) {
      throw new LeadReferenceError("Active lead team not found");
    }
  }
  if (lead.tag_ids?.length) {
    const tags = await client.query(
      "SELECT tag_id FROM tags WHERE tag_id=ANY($1::uuid[]) AND archived_at IS NULL",
      [lead.tag_ids],
    );
    if (tags.rowCount !== lead.tag_ids.length) {
      throw new LeadReferenceError("One or more active tags were not found");
    }
  }
  const stage = await client.query(
    `SELECT stage_id FROM project_lead_stages
     WHERE project_id=$1 AND is_active=TRUE AND is_initial=TRUE`,
    [lead.project_id],
  );
  if (!stage.rowCount) {
    throw new LeadReferenceError("Project has no active initial lead stage");
  }
  return stage.rows[0].stage_id as string;
}

export async function replaceLeadTags(
  client: PoolClient,
  leadId: string,
  tagIds: string[],
  performedBy: string | null = null,
): Promise<void> {
  const current = await client.query(
    "SELECT tag_id FROM lead_tags WHERE lead_id=$1",
    [leadId],
  );
  const currentIds = new Set<string>(current.rows.map((row) => row.tag_id));
  const nextIds = new Set(tagIds);
  const added = tagIds.filter((tagId) => !currentIds.has(tagId));
  const removed = [...currentIds].filter((tagId) => !nextIds.has(tagId));

  await client.query("DELETE FROM lead_tags WHERE lead_id=$1", [leadId]);
  if (tagIds.length) {
    await client.query(
      `INSERT INTO lead_tags (lead_id, tag_id)
       SELECT $1, tag_id FROM UNNEST($2::uuid[]) AS tags(tag_id)`,
      [leadId, tagIds],
    );
  }
  if (added.length || removed.length) {
    await client.query(
      `INSERT INTO lead_tag_history (lead_id, tag_id, action, performed_by)
       SELECT $1, tag_id, 'added', $4 FROM UNNEST($2::uuid[]) AS added(tag_id)
       UNION ALL
       SELECT $1, tag_id, 'removed', $4 FROM UNNEST($3::uuid[]) AS removed(tag_id)`,
      [leadId, added, removed, performedBy],
    );
  }
}

export async function createLead(
  client: PoolClient,
  lead: LeadWrite,
  intakeEventId: string | null = null,
): Promise<Record<string, unknown>> {
  const stageId = await ensureReferences(client, lead);
  const result = await client.query(
    `INSERT INTO leads (
       contact_id, project_id, source_id, campaign_id, intake_event_id, stage_id,
       sub_source, temperature, customer_type, current_owner_user_id,
       current_team_id, preferred_location, preferred_config, preferred_facing,
       preferred_floor, preferred_view, budget, buying_reason, qualification_data,
       assigned_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19::jsonb,
       CASE WHEN $10::uuid IS NULL AND $11::uuid IS NULL THEN NULL ELSE CURRENT_TIMESTAMP END)
     RETURNING ${LEAD_COLUMNS}`,
    [
      lead.contact_id,
      lead.project_id,
      lead.source_id ?? null,
      lead.campaign_id ?? null,
      intakeEventId,
      stageId,
      lead.sub_source ?? null,
      lead.temperature ?? null,
      lead.customer_type ?? null,
      lead.current_owner_user_id ?? null,
      lead.current_team_id ?? null,
      lead.preferred_location ?? null,
      lead.preferred_config ?? null,
      lead.preferred_facing ?? null,
      lead.preferred_floor ?? null,
      lead.preferred_view ?? null,
      lead.budget ?? null,
      lead.buying_reason ?? null,
      JSON.stringify(lead.qualification_data ?? {}),
    ],
  );
  const created = result.rows[0];
  if (lead.tag_ids) {
    await replaceLeadTags(client, created.lead_id, lead.tag_ids);
  }
  await addOwnershipHistory(
    client,
    created.lead_id,
    { current_owner_user_id: null, current_team_id: null },
    {
      current_owner_user_id: created.current_owner_user_id,
      current_team_id: created.current_team_id,
    },
  );
  await addLeadHistory(
    client,
    { lead_id: created.lead_id },
    "created",
    "active",
    stageId,
    {
      intake_event_id: intakeEventId,
    },
  );
  await startSlaInstancesForLead(client, created);
  await applyRoutingForLead(client, created);
  return created;
}
