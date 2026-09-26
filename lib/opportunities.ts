import type { Pool, PoolClient } from "pg";
import { isObject } from "@/utils/isObject";
import { validateText } from "@/utils/validateText";

type Queryable = Pick<Pool | PoolClient, "query">;

export const OPPORTUNITY_COLUMNS = `
  o.opportunity_id, o.company_id, o.project_id, o.lead_id, o.contact_id,
  o.opportunity_name, o.description, o.stage_key, o.status, o.amount,
  o.probability, o.expected_close_date, o.current_owner_user_id,
  o.current_team_id, o.outcome, o.closing_reason, o.closing_notes,
  o.created_by, o.updated_by, o.closed_by, o.qualified_at, o.closed_at,
  o.created_at, o.updated_at
`;

export type OpportunityPatch = {
  opportunity_name?: string;
  description?: string | null;
  amount?: number | null;
  probability?: number;
  expected_close_date?: string | null;
  current_owner_user_id?: string | null;
  current_team_id?: string | null;
};

type ValidationResult<T> =
  | { ok: true; data: T }
  | { ok: false; errors: string[] };

function nullableUuid(
  value: unknown,
  field: string,
  errors: string[],
): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (
    typeof value !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  ) {
    errors.push(`${field} must be a valid UUID or null`);
    return undefined;
  }
  return value.toLowerCase();
}

export function validateOpportunityPatch(
  body: unknown,
): ValidationResult<OpportunityPatch> {
  if (!isObject(body) || Array.isArray(body)) {
    return { ok: false, errors: ["Request body must be a JSON object"] };
  }
  const allowed = new Set([
    "opportunity_name",
    "description",
    "amount",
    "probability",
    "expected_close_date",
    "current_owner_user_id",
    "current_team_id",
  ]);
  const errors = Object.keys(body)
    .filter((key) => !allowed.has(key))
    .map((key) => `Unknown field: ${key}`);
  if (!Object.keys(body).length) errors.push("At least one field is required");

  const name = validateText(
    body.opportunity_name,
    "opportunity_name",
    250,
    false,
    errors,
  );
  const description = validateText(
    body.description,
    "description",
    10000,
    true,
    errors,
  );

  let amount: number | null | undefined;
  if (body.amount === null) amount = null;
  else if (body.amount !== undefined) {
    if (
      typeof body.amount !== "number" ||
      !Number.isFinite(body.amount) ||
      body.amount < 0
    ) {
      errors.push("amount must be a non-negative number or null");
    } else amount = body.amount;
  }

  let probability: number | undefined;
  if (body.probability !== undefined) {
    if (
      !Number.isInteger(body.probability) ||
      Number(body.probability) < 0 ||
      Number(body.probability) > 100
    ) {
      errors.push("probability must be an integer between 0 and 100");
    } else probability = Number(body.probability);
  }

  let expectedCloseDate: string | null | undefined;
  if (body.expected_close_date === null) expectedCloseDate = null;
  else if (body.expected_close_date !== undefined) {
    if (
      typeof body.expected_close_date !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(body.expected_close_date) ||
      Number.isNaN(Date.parse(`${body.expected_close_date}T00:00:00Z`))
    ) {
      errors.push("expected_close_date must be YYYY-MM-DD or null");
    } else expectedCloseDate = body.expected_close_date;
  }

  const owner = nullableUuid(
    body.current_owner_user_id,
    "current_owner_user_id",
    errors,
  );
  const team = nullableUuid(
    body.current_team_id,
    "current_team_id",
    errors,
  );

  return errors.length
    ? { ok: false, errors }
    : {
        ok: true,
        data: {
          opportunity_name: name ?? undefined,
          description,
          amount,
          probability,
          expected_close_date: expectedCloseDate,
          current_owner_user_id: owner,
          current_team_id: team,
        },
      };
}

export function validStageKey(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[a-z0-9]+(?:_[a-z0-9]+)*$/.test(value) &&
    value.length <= 100
  );
}

export async function getOpportunity(
  client: Queryable,
  opportunityId: string,
  lock = false,
): Promise<Record<string, unknown> | null> {
  const result = await client.query(
    `SELECT * FROM opportunities WHERE opportunity_id=$1${lock ? " FOR UPDATE" : ""}`,
    [opportunityId],
  );
  return result.rows[0] ?? null;
}

export async function validateOpportunityReferences(
  client: PoolClient,
  companyId: number,
  data: OpportunityPatch,
): Promise<string[]> {
  const errors: string[] = [];
  if (data.current_owner_user_id) {
    const user = await client.query(
      `SELECT 1 FROM users u
       JOIN teams t ON t.team_id=u.team_id
       WHERE u.user_id=$1 AND t.company_id=$2 AND u.is_active=TRUE
         AND u.deleted_at IS NULL AND t.is_active=TRUE`,
      [data.current_owner_user_id, companyId],
    );
    if (!user.rowCount)
      errors.push("current_owner_user_id must be an active company user");
  }
  if (data.current_team_id) {
    const team = await client.query(
      `SELECT 1 FROM teams
       WHERE team_id=$1 AND company_id=$2 AND is_active=TRUE`,
      [data.current_team_id, companyId],
    );
    if (!team.rowCount)
      errors.push("current_team_id must be an active company team");
  }
  return errors;
}

export async function addOpportunityStateHistory(
  client: PoolClient,
  opportunity: Record<string, unknown>,
  action: string,
  nextStatus: string,
  nextStageKey: string,
  performedBy: string | null,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  await client.query(
    `INSERT INTO opportunity_state_history (
       opportunity_id, action, from_status, to_status, from_stage_key,
       to_stage_key, metadata, performed_by
     ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8)`,
    [
      opportunity.opportunity_id,
      action,
      opportunity.status,
      nextStatus,
      opportunity.stage_key,
      nextStageKey,
      JSON.stringify(metadata),
      performedBy,
    ],
  );
}

export async function addOpportunityOwnershipHistory(
  client: PoolClient,
  opportunityId: string,
  previous: { owner: string | null; team: string | null },
  next: { owner: string | null; team: string | null },
  performedBy: string | null,
): Promise<void> {
  if (previous.owner === next.owner && previous.team === next.team) return;
  const hadOwner = Boolean(previous.owner || previous.team);
  const hasOwner = Boolean(next.owner || next.team);
  const changeType = !hadOwner
    ? "assigned"
    : !hasOwner
      ? "unassigned"
      : "transferred";
  await client.query(
    `INSERT INTO opportunity_ownership_history (
       opportunity_id, change_type, from_owner_user_id, to_owner_user_id,
       from_team_id, to_team_id, performed_by
     ) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [
      opportunityId,
      changeType,
      previous.owner,
      next.owner,
      previous.team,
      next.team,
      performedBy,
    ],
  );
}

export async function getOpportunityDetail(
  client: Queryable,
  opportunityId: string,
): Promise<Record<string, unknown> | null> {
  const result = await client.query(
    `SELECT ${OPPORTUNITY_COLUMNS},
       p.project_name, p.project_code,
       JSONB_BUILD_OBJECT(
         'contact_id', c.contact_id, 'first_name', c.first_name,
         'last_name', c.last_name, 'email', c.email,
         'phone_number', c.phone_number
       ) AS contact,
       CASE WHEN owner.user_id IS NULL THEN NULL ELSE JSONB_BUILD_OBJECT(
         'user_id', owner.user_id, 'first_name', owner.first_name,
         'last_name', owner.last_name, 'email', owner.email
       ) END AS owner,
       CASE WHEN team.team_id IS NULL THEN NULL ELSE JSONB_BUILD_OBJECT(
         'team_id', team.team_id, 'team_name', team.name
       ) END AS team
     FROM opportunities o
     JOIN projects p ON p.project_id=o.project_id
     JOIN contacts c ON c.contact_id=o.contact_id
     LEFT JOIN users owner ON owner.user_id=o.current_owner_user_id
     LEFT JOIN teams team ON team.team_id=o.current_team_id
     WHERE o.opportunity_id=$1`,
    [opportunityId],
  );
  return result.rows[0] ?? null;
}
