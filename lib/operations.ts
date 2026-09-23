import type { PoolClient } from "pg";
import { isUuid } from "@/lib/permissions";
import { isObject } from "@/utils/isObject";
import { validateText } from "@/utils/validateText";

export const ASSIGNMENT_COLUMNS = `
  a.assignment_id, a.company_id, a.project_id, a.lead_id, a.queue_id,
  a.assigned_to_user_id, a.assigned_to_team_id, a.assigned_by,
  a.status, a.priority, a.notes, a.rejection_reason, a.release_reason,
  a.assigned_at, a.accepted_at, a.rejected_at, a.released_at,
  a.completed_at, a.created_at, a.updated_at
`;

export const QUEUE_COLUMNS = `
  q.queue_id, q.company_id, q.project_id, q.team_id, q.queue_code,
  q.queue_name, q.description, q.assignment_strategy, q.is_active,
  q.last_assigned_user_id, q.created_by, q.created_at, q.updated_at
`;

export const ROUTING_RULE_COLUMNS = `
  r.rule_id, r.company_id, r.project_id, r.rule_name, r.description,
  r.priority, r.conditions, r.action_type, r.target_queue_id,
  r.target_user_id, r.target_team_id, r.is_active, r.created_by,
  r.created_at, r.updated_at
`;

export const SLA_RULE_COLUMNS = `
  s.sla_rule_id, s.company_id, s.project_id, s.rule_name, s.description,
  s.applies_to, s.priority, s.conditions, s.response_minutes,
  s.resolution_minutes, s.escalation_minutes, s.is_active, s.created_by,
  s.created_at, s.updated_at
`;

export const SLA_INSTANCE_COLUMNS = `
  i.sla_id, i.sla_rule_id, i.company_id, i.project_id, i.lead_id,
  i.assignment_id, i.status, i.started_at, i.response_due_at,
  i.resolution_due_at, i.responded_at, i.resolved_at, i.breached_at,
  i.escalated_at, i.escalated_by, i.escalation_notes, i.waived_at,
  i.waived_by, i.waiver_reason, i.created_at, i.updated_at
`;

export function parseUuid(value: string): string | null {
  return isUuid(value) ? value.toLowerCase() : null;
}

type ValidationResult<T> =
  { ok: true; data: T } | { ok: false; errors: string[] };

function validateInteger(
  value: unknown,
  field: string,
  minimum: number,
  maximum: number,
  errors: string[],
): number | undefined {
  if (value === undefined) return undefined;
  if (
    !Number.isSafeInteger(value) ||
    Number(value) < minimum ||
    Number(value) > maximum
  ) {
    errors.push(
      `${field} must be an integer between ${minimum} and ${maximum}`,
    );
    return undefined;
  }
  return Number(value);
}

function validateNullableUuid(
  value: unknown,
  field: string,
  errors: string[],
): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (!isUuid(value)) {
    errors.push(`${field} must be a valid UUID or null`);
    return undefined;
  }
  return value.toLowerCase();
}

function validateConditions(
  value: unknown,
  field: string,
  errors: string[],
): Record<string, unknown> | undefined {
  if (value === undefined) return undefined;
  if (!isObject(value) || Array.isArray(value)) {
    errors.push(`${field} must be a JSON object`);
    return undefined;
  }
  return value;
}

export type AssignmentInput = {
  lead_id: string;
  queue_id?: string | null;
  assigned_to_user_id?: string | null;
  assigned_to_team_id?: string | null;
  priority?: number;
  notes?: string | null;
};

export function validateAssignmentPayload(
  body: unknown,
): ValidationResult<AssignmentInput> {
  if (!isObject(body) || Array.isArray(body)) {
    return { ok: false, errors: ["Request body must be a JSON object"] };
  }
  const allowed = new Set([
    "lead_id",
    "queue_id",
    "assigned_to_user_id",
    "assigned_to_team_id",
    "priority",
    "notes",
  ]);
  const errors = Object.keys(body)
    .filter((key) => !allowed.has(key))
    .map((key) => `Unknown field: ${key}`);
  const leadId = validateNullableUuid(body.lead_id, "lead_id", errors);
  const queueId = validateNullableUuid(body.queue_id, "queue_id", errors);
  const userId = validateNullableUuid(
    body.assigned_to_user_id,
    "assigned_to_user_id",
    errors,
  );
  const teamId = validateNullableUuid(
    body.assigned_to_team_id,
    "assigned_to_team_id",
    errors,
  );
  const priority = validateInteger(
    body.priority,
    "priority",
    -1000,
    1000,
    errors,
  );
  const notes = validateText(body.notes, "notes", 5000, true, errors);
  if (!leadId) errors.push("lead_id is required");
  if (!userId && !teamId) {
    errors.push("assigned_to_user_id or assigned_to_team_id is required");
  }
  return errors.length
    ? { ok: false, errors }
    : {
        ok: true,
        data: {
          lead_id: leadId as string,
          queue_id: queueId,
          assigned_to_user_id: userId,
          assigned_to_team_id: teamId,
          priority,
          notes,
        },
      };
}

export type QueueInput = {
  project_id?: number | null;
  team_id?: string | null;
  queue_code?: string;
  queue_name?: string;
  description?: string | null;
  assignment_strategy?: "manual" | "round_robin" | "load_balanced";
  is_active?: boolean;
  member_user_ids?: string[];
};

export function validateQueuePayload(
  body: unknown,
  partial: boolean,
): ValidationResult<QueueInput> {
  if (!isObject(body) || Array.isArray(body)) {
    return { ok: false, errors: ["Request body must be a JSON object"] };
  }
  const allowed = new Set([
    "project_id",
    "team_id",
    "queue_code",
    "queue_name",
    "description",
    "assignment_strategy",
    "is_active",
    "member_user_ids",
  ]);
  const errors = Object.keys(body)
    .filter((key) => !allowed.has(key))
    .map((key) => `Unknown field: ${key}`);
  let projectId: number | null | undefined;
  if (body.project_id === null) projectId = null;
  else if (body.project_id !== undefined) {
    projectId = validateInteger(
      body.project_id,
      "project_id",
      1,
      2147483647,
      errors,
    );
  }
  const teamId = validateNullableUuid(body.team_id, "team_id", errors);
  const queueCode = validateText(
    body.queue_code,
    "queue_code",
    50,
    false,
    errors,
  );
  const queueName = validateText(
    body.queue_name,
    "queue_name",
    150,
    false,
    errors,
  );
  const description = validateText(
    body.description,
    "description",
    5000,
    true,
    errors,
  );
  const strategies = ["manual", "round_robin", "load_balanced"] as const;
  let strategy: QueueInput["assignment_strategy"];
  if (body.assignment_strategy !== undefined) {
    if (
      !strategies.includes(
        body.assignment_strategy as (typeof strategies)[number],
      )
    ) {
      errors.push(
        `assignment_strategy must be one of: ${strategies.join(", ")}`,
      );
    } else
      strategy = body.assignment_strategy as QueueInput["assignment_strategy"];
  }
  let isActive: boolean | undefined;
  if (body.is_active !== undefined) {
    if (typeof body.is_active !== "boolean")
      errors.push("is_active must be a boolean");
    else isActive = body.is_active;
  }
  let members: string[] | undefined;
  if (body.member_user_ids !== undefined) {
    if (!Array.isArray(body.member_user_ids)) {
      errors.push("member_user_ids must be an array of UUIDs");
    } else {
      members = [];
      for (const value of body.member_user_ids) {
        if (!isUuid(value))
          errors.push("member_user_ids must contain valid UUIDs");
        else members.push(value.toLowerCase());
      }
      if (new Set(members).size !== members.length) {
        errors.push("member_user_ids cannot contain duplicates");
      }
    }
  }
  if (!partial) {
    if (!queueCode) errors.push("queue_code is required");
    if (!queueName) errors.push("queue_name is required");
  } else if (Object.keys(body).length === 0)
    errors.push("At least one field is required");
  return errors.length
    ? { ok: false, errors }
    : {
        ok: true,
        data: {
          project_id: projectId,
          team_id: teamId,
          queue_code: queueCode ?? undefined,
          queue_name: queueName ?? undefined,
          description,
          assignment_strategy: strategy,
          is_active: isActive,
          member_user_ids: members,
        },
      };
}

export type RoutingRuleInput = {
  project_id?: number | null;
  rule_name?: string;
  description?: string | null;
  priority?: number;
  conditions?: Record<string, unknown>;
  action_type?: "queue" | "user" | "team";
  target_queue_id?: string | null;
  target_user_id?: string | null;
  target_team_id?: string | null;
};

export function validateRoutingRulePayload(
  body: unknown,
  partial: boolean,
): ValidationResult<RoutingRuleInput> {
  if (!isObject(body) || Array.isArray(body)) {
    return { ok: false, errors: ["Request body must be a JSON object"] };
  }
  const allowed = new Set([
    "project_id",
    "rule_name",
    "description",
    "priority",
    "conditions",
    "action_type",
    "target_queue_id",
    "target_user_id",
    "target_team_id",
  ]);
  const errors = Object.keys(body)
    .filter((key) => !allowed.has(key))
    .map((key) => `Unknown field: ${key}`);
  let projectId: number | null | undefined;
  if (body.project_id === null) projectId = null;
  else if (body.project_id !== undefined)
    projectId = validateInteger(
      body.project_id,
      "project_id",
      1,
      2147483647,
      errors,
    );
  const name = validateText(body.rule_name, "rule_name", 150, false, errors);
  const description = validateText(
    body.description,
    "description",
    5000,
    true,
    errors,
  );
  const priority = validateInteger(body.priority, "priority", 1, 10000, errors);
  const conditions = validateConditions(body.conditions, "conditions", errors);
  const actions = ["queue", "user", "team"] as const;
  let actionType: RoutingRuleInput["action_type"];
  if (body.action_type !== undefined) {
    if (!actions.includes(body.action_type as (typeof actions)[number]))
      errors.push(`action_type must be one of: ${actions.join(", ")}`);
    else actionType = body.action_type as RoutingRuleInput["action_type"];
  }
  const queueId = validateNullableUuid(
    body.target_queue_id,
    "target_queue_id",
    errors,
  );
  const userId = validateNullableUuid(
    body.target_user_id,
    "target_user_id",
    errors,
  );
  const teamId = validateNullableUuid(
    body.target_team_id,
    "target_team_id",
    errors,
  );
  if (!partial) {
    if (!name) errors.push("rule_name is required");
    if (!actionType) errors.push("action_type is required");
  } else if (Object.keys(body).length === 0)
    errors.push("At least one field is required");
  if (actionType) {
    const selected =
      Number(Boolean(queueId)) +
      Number(Boolean(userId)) +
      Number(Boolean(teamId));
    if (
      selected !== 1 ||
      (actionType === "queue" && !queueId) ||
      (actionType === "user" && !userId) ||
      (actionType === "team" && !teamId)
    ) {
      errors.push("Exactly one target matching action_type is required");
    }
  }
  return errors.length
    ? { ok: false, errors }
    : {
        ok: true,
        data: {
          project_id: projectId,
          rule_name: name ?? undefined,
          description,
          priority,
          conditions,
          action_type: actionType,
          target_queue_id: queueId,
          target_user_id: userId,
          target_team_id: teamId,
        },
      };
}

export type SlaRuleInput = {
  project_id?: number | null;
  rule_name?: string;
  description?: string | null;
  applies_to?: "lead" | "assignment";
  priority?: number;
  conditions?: Record<string, unknown>;
  response_minutes?: number | null;
  resolution_minutes?: number | null;
  escalation_minutes?: number | null;
};

export function validateSlaRulePayload(
  body: unknown,
  partial: boolean,
): ValidationResult<SlaRuleInput> {
  if (!isObject(body) || Array.isArray(body))
    return { ok: false, errors: ["Request body must be a JSON object"] };
  const allowed = new Set([
    "project_id",
    "rule_name",
    "description",
    "applies_to",
    "priority",
    "conditions",
    "response_minutes",
    "resolution_minutes",
    "escalation_minutes",
  ]);
  const errors = Object.keys(body)
    .filter((key) => !allowed.has(key))
    .map((key) => `Unknown field: ${key}`);
  let projectId: number | null | undefined;
  if (body.project_id === null) projectId = null;
  else if (body.project_id !== undefined)
    projectId = validateInteger(
      body.project_id,
      "project_id",
      1,
      2147483647,
      errors,
    );
  const name = validateText(body.rule_name, "rule_name", 150, false, errors);
  const description = validateText(
    body.description,
    "description",
    5000,
    true,
    errors,
  );
  let appliesTo: SlaRuleInput["applies_to"];
  if (body.applies_to !== undefined) {
    if (!["lead", "assignment"].includes(String(body.applies_to)))
      errors.push("applies_to must be lead or assignment");
    else appliesTo = body.applies_to as SlaRuleInput["applies_to"];
  }
  const priority = validateInteger(body.priority, "priority", 1, 10000, errors);
  const conditions = validateConditions(body.conditions, "conditions", errors);
  const duration = (
    field: "response_minutes" | "resolution_minutes" | "escalation_minutes",
    minimum: number,
  ) => {
    if (body[field] === null) return null;
    return validateInteger(body[field], field, minimum, 5256000, errors);
  };
  const response = duration("response_minutes", 1);
  const resolution = duration("resolution_minutes", 1);
  const escalation = duration("escalation_minutes", 0);
  if (!partial) {
    if (!name) errors.push("rule_name is required");
    if (!appliesTo) appliesTo = "assignment";
    if (response == null && resolution == null)
      errors.push("response_minutes or resolution_minutes is required");
  } else if (Object.keys(body).length === 0)
    errors.push("At least one field is required");
  return errors.length
    ? { ok: false, errors }
    : {
        ok: true,
        data: {
          project_id: projectId,
          rule_name: name ?? undefined,
          description,
          applies_to: appliesTo,
          priority,
          conditions,
          response_minutes: response,
          resolution_minutes: resolution,
          escalation_minutes: escalation,
        },
      };
}

export function matchesConditions(
  record: Record<string, unknown>,
  conditions: Record<string, unknown>,
): boolean {
  return Object.entries(conditions).every(([field, expected]) => {
    const actual = record[field];
    if (Array.isArray(expected))
      return expected.some((value) => value === actual);
    if (isObject(expected) && !Array.isArray(expected)) {
      if ("eq" in expected && actual !== expected.eq) return false;
      if (
        "in" in expected &&
        Array.isArray(expected.in) &&
        !expected.in.includes(actual)
      )
        return false;
      if (
        "gte" in expected &&
        (typeof actual !== "number" || actual < Number(expected.gte))
      )
        return false;
      if (
        "lte" in expected &&
        (typeof actual !== "number" || actual > Number(expected.lte))
      )
        return false;
      return true;
    }
    return actual === expected;
  });
}

export async function addAssignmentHistory(
  client: PoolClient,
  assignment: Record<string, unknown>,
  action: string,
  toStatus: string,
  performedBy: string | null,
  changes: {
    userId?: string | null;
    teamId?: string | null;
    reason?: string | null;
    metadata?: Record<string, unknown>;
  } = {},
): Promise<void> {
  await client.query(
    `INSERT INTO assignment_history (
       assignment_id, action, from_status, to_status,
       from_user_id, to_user_id, from_team_id, to_team_id,
       reason, metadata, performed_by
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11)`,
    [
      assignment.assignment_id,
      action,
      assignment.status ?? null,
      toStatus,
      assignment.assigned_to_user_id ?? null,
      changes.userId ?? assignment.assigned_to_user_id ?? null,
      assignment.assigned_to_team_id ?? null,
      changes.teamId ?? assignment.assigned_to_team_id ?? null,
      changes.reason ?? null,
      JSON.stringify(changes.metadata ?? {}),
      performedBy,
    ],
  );
}

export async function markOverdueSlaInstances(
  client: PoolClient,
  companyId?: number,
): Promise<void> {
  const result = await client.query(
    `UPDATE sla_instances
     SET status='breached', breached_at=COALESCE(breached_at, CURRENT_TIMESTAMP), updated_at=CURRENT_TIMESTAMP
     WHERE status='running'
       AND ($1::integer IS NULL OR company_id=$1)
       AND (
         (responded_at IS NULL AND response_due_at IS NOT NULL AND response_due_at < CURRENT_TIMESTAMP)
         OR (resolved_at IS NULL AND resolution_due_at IS NOT NULL AND resolution_due_at < CURRENT_TIMESTAMP)
       )
     RETURNING sla_id`,
    [companyId ?? null],
  );
  for (const row of result.rows) {
    await client.query(
      `INSERT INTO sla_instance_history (sla_id, action, from_status, to_status)
       VALUES ($1, 'breached', 'running', 'breached')`,
      [row.sla_id],
    );
  }
}
