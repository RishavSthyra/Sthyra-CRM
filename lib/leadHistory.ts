import type { Pool, PoolClient } from "pg";
import { isUuid } from "@/lib/permissions";
import { isObject } from "@/utils/isObject";
import { validateText } from "@/utils/validateText";

export const ATTRIBUTION_COLUMNS = `
  attribution_id, lead_id, source_id, campaign_id, attribution_type,
  sub_source, occurred_at, metadata, created_by, created_at
`;

export const NEXT_ACTION_COLUMNS = `
  lead_id, action_type, summary, due_at, status, notes,
  created_by, updated_by, created_at, updated_at
`;

export async function leadExists(
  client: Pick<Pool | PoolClient, "query">,
  leadId: string,
): Promise<boolean> {
  const result = await client.query("SELECT 1 FROM leads WHERE lead_id=$1", [
    leadId,
  ]);
  return Boolean(result.rowCount);
}

export async function listOwnershipHistory(
  client: Pick<Pool | PoolClient, "query">,
  leadId: string,
  limit: number,
  offset: number,
  transfersOnly = false,
): Promise<{ rows: Record<string, unknown>[]; total: number }> {
  const transferFilter = transfersOnly
    ? " AND oh.change_type='transferred'"
    : "";
  const count = await client.query(
    `SELECT COUNT(*)::integer AS total FROM lead_ownership_history oh
     WHERE oh.lead_id=$1${transferFilter}`,
    [leadId],
  );
  const result = await client.query(
    `SELECT oh.*,
            CASE WHEN from_user.user_id IS NULL THEN NULL ELSE JSONB_BUILD_OBJECT(
              'user_id', from_user.user_id, 'first_name', from_user.first_name,
              'last_name', from_user.last_name, 'email', from_user.email
            ) END AS from_owner,
            CASE WHEN to_user.user_id IS NULL THEN NULL ELSE JSONB_BUILD_OBJECT(
              'user_id', to_user.user_id, 'first_name', to_user.first_name,
              'last_name', to_user.last_name, 'email', to_user.email
            ) END AS to_owner,
            CASE WHEN from_team.team_id IS NULL THEN NULL ELSE JSONB_BUILD_OBJECT(
              'team_id', from_team.team_id, 'team_name', from_team.name
            ) END AS from_team,
            CASE WHEN to_team.team_id IS NULL THEN NULL ELSE JSONB_BUILD_OBJECT(
              'team_id', to_team.team_id, 'team_name', to_team.name
            ) END AS to_team
     FROM lead_ownership_history oh
     LEFT JOIN users from_user ON from_user.user_id=oh.from_owner_user_id
     LEFT JOIN users to_user ON to_user.user_id=oh.to_owner_user_id
     LEFT JOIN teams from_team ON from_team.team_id=oh.from_team_id
     LEFT JOIN teams to_team ON to_team.team_id=oh.to_team_id
     WHERE oh.lead_id=$1${transferFilter}
     ORDER BY oh.created_at DESC, oh.ownership_history_id DESC
     LIMIT $2 OFFSET $3`,
    [leadId, limit, offset],
  );
  return { rows: result.rows, total: Number(count.rows[0]?.total ?? 0) };
}

type AttributionWrite = {
  source_id: string | null;
  campaign_id: string | null;
  attribution_type: "first_touch" | "last_touch" | "assist" | "manual";
  sub_source: string | null;
  occurred_at: string;
  metadata: Record<string, unknown>;
};

type AttributionValidation =
  | { ok: true; data: AttributionWrite }
  | { ok: false; errors: string[] };

export function validateAttributionPayload(
  body: unknown,
): AttributionValidation {
  if (!isObject(body) || Array.isArray(body)) {
    return { ok: false, errors: ["Request body must be a JSON object"] };
  }

  const allowed = new Set([
    "source_id",
    "campaign_id",
    "attribution_type",
    "sub_source",
    "occurred_at",
    "metadata",
  ]);
  const errors = Object.keys(body)
    .filter((field) => !allowed.has(field))
    .map((field) => `Unknown field: ${field}`);

  let sourceId: string | null = null;
  if (body.source_id !== undefined && body.source_id !== null) {
    if (!isUuid(body.source_id)) {
      errors.push("source_id must be a valid UUID or null");
    } else {
      sourceId = body.source_id.toLowerCase();
    }
  }

  let campaignId: string | null = null;
  if (body.campaign_id !== undefined && body.campaign_id !== null) {
    if (!isUuid(body.campaign_id)) {
      errors.push("campaign_id must be a valid UUID or null");
    } else {
      campaignId = body.campaign_id.toLowerCase();
    }
  }

  const types = ["first_touch", "last_touch", "assist", "manual"] as const;
  const attributionType = body.attribution_type;
  if (
    typeof attributionType !== "string" ||
    !types.includes(attributionType as (typeof types)[number])
  ) {
    errors.push(
      "attribution_type must be first_touch, last_touch, assist, or manual",
    );
  }

  const subSource = validateText(
    body.sub_source,
    "sub_source",
    150,
    true,
    errors,
  );
  if (!sourceId && !campaignId && !subSource) {
    errors.push(
      "At least one of source_id, campaign_id, or sub_source is required",
    );
  }

  let occurredAt = new Date().toISOString();
  if (body.occurred_at !== undefined) {
    if (
      typeof body.occurred_at !== "string" ||
      !body.occurred_at.trim() ||
      Number.isNaN(Date.parse(body.occurred_at))
    ) {
      errors.push("occurred_at must be a valid ISO date-time string");
    } else {
      occurredAt = new Date(body.occurred_at).toISOString();
    }
  }

  let metadata: Record<string, unknown> = {};
  if (body.metadata !== undefined) {
    if (!isObject(body.metadata) || Array.isArray(body.metadata)) {
      errors.push("metadata must be a JSON object");
    } else {
      metadata = body.metadata;
    }
  }

  if (errors.length) {
    return { ok: false, errors };
  }
  return {
    ok: true,
    data: {
      source_id: sourceId,
      campaign_id: campaignId,
      attribution_type: attributionType as AttributionWrite["attribution_type"],
      sub_source: subSource ?? null,
      occurred_at: occurredAt,
      metadata,
    },
  };
}

type NextActionWrite = {
  action_type: string;
  summary: string;
  due_at: string;
  status: "pending" | "completed" | "cancelled";
  notes: string | null;
};

type NextActionValidation =
  | { ok: true; data: NextActionWrite }
  | { ok: false; errors: string[] };

export function validateNextActionPayload(body: unknown): NextActionValidation {
  if (!isObject(body) || Array.isArray(body)) {
    return { ok: false, errors: ["Request body must be a JSON object"] };
  }

  const allowed = new Set([
    "action_type",
    "summary",
    "due_at",
    "status",
    "notes",
  ]);
  const errors = Object.keys(body)
    .filter((field) => !allowed.has(field))
    .map((field) => `Unknown field: ${field}`);
  const actionType = validateText(
    body.action_type,
    "action_type",
    50,
    false,
    errors,
  );
  const summary = validateText(body.summary, "summary", 500, false, errors);
  const notes = validateText(body.notes, "notes", 5000, true, errors);

  let dueAt = "";
  if (
    typeof body.due_at !== "string" ||
    !body.due_at.trim() ||
    Number.isNaN(Date.parse(body.due_at))
  ) {
    errors.push("due_at must be a valid ISO date-time string");
  } else {
    dueAt = new Date(body.due_at).toISOString();
  }

  const statuses = ["pending", "completed", "cancelled"] as const;
  const status = body.status ?? "pending";
  if (
    typeof status !== "string" ||
    !statuses.includes(status as (typeof statuses)[number])
  ) {
    errors.push("status must be pending, completed, or cancelled");
  }

  for (const field of ["action_type", "summary", "due_at"] as const) {
    if (body[field] === undefined) {
      errors.push(`${field} is required`);
    }
  }

  if (errors.length) {
    return { ok: false, errors };
  }
  return {
    ok: true,
    data: {
      action_type: actionType as string,
      summary: summary as string,
      due_at: dueAt,
      status: status as NextActionWrite["status"],
      notes: notes ?? null,
    },
  };
}

export async function addOwnershipHistory(
  client: PoolClient,
  leadId: string,
  previous: {
    current_owner_user_id: string | null;
    current_team_id: string | null;
  },
  next: {
    current_owner_user_id: string | null;
    current_team_id: string | null;
  },
  performedBy: string | null = null,
): Promise<void> {
  if (
    previous.current_owner_user_id === next.current_owner_user_id &&
    previous.current_team_id === next.current_team_id
  ) {
    return;
  }

  const hadAssignment = Boolean(
    previous.current_owner_user_id || previous.current_team_id,
  );
  const hasAssignment = Boolean(
    next.current_owner_user_id || next.current_team_id,
  );
  const changeType = !hadAssignment
    ? "assigned"
    : !hasAssignment
      ? "unassigned"
      : "transferred";

  await client.query(
    `INSERT INTO lead_ownership_history (
       lead_id, change_type, from_owner_user_id, to_owner_user_id,
       from_team_id, to_team_id, performed_by
     ) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [
      leadId,
      changeType,
      previous.current_owner_user_id,
      next.current_owner_user_id,
      previous.current_team_id,
      next.current_team_id,
      performedBy,
    ],
  );
}
