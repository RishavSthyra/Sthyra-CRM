import type { PoolClient } from "pg";
import {
  createAssignment,
  OperationsReferenceError,
} from "@/lib/assignmentService";
import { matchesConditions, RoutingRuleInput } from "@/lib/operations";

export async function validateRoutingReferences(
  client: PoolClient,
  companyId: number,
  rule: RoutingRuleInput,
): Promise<void> {
  if (rule.project_id) {
    const project = await client.query(
      "SELECT project_id FROM projects WHERE project_id=$1 AND company_id=$2 AND is_active=TRUE",
      [rule.project_id, companyId],
    );
    if (!project.rowCount)
      throw new OperationsReferenceError("Active company project not found");
  }
  if (rule.target_queue_id) {
    const queue = await client.query(
      `SELECT queue_id FROM queues WHERE queue_id=$1 AND company_id=$2 AND is_active=TRUE
       AND ($3::integer IS NULL OR project_id IS NULL OR project_id=$3)`,
      [rule.target_queue_id, companyId, rule.project_id ?? null],
    );
    if (!queue.rowCount)
      throw new OperationsReferenceError(
        "Active compatible target queue not found",
      );
  }
  if (rule.target_user_id) {
    const user = await client.query(
      `SELECT u.user_id FROM users u JOIN teams t ON t.team_id=u.team_id
       WHERE u.user_id=$1 AND u.is_active=TRUE AND u.deleted_at IS NULL
         AND t.company_id=$2 AND t.is_active=TRUE`,
      [rule.target_user_id, companyId],
    );
    if (!user.rowCount)
      throw new OperationsReferenceError(
        "Active company target user not found",
      );
  }
  if (rule.target_team_id) {
    const team = await client.query(
      "SELECT team_id FROM teams WHERE team_id=$1 AND company_id=$2 AND is_active=TRUE",
      [rule.target_team_id, companyId],
    );
    if (!team.rowCount)
      throw new OperationsReferenceError(
        "Active company target team not found",
      );
  }
}

export async function applyRoutingForLead(
  client: PoolClient,
  lead: Record<string, unknown>,
  actorId: string | null = null,
): Promise<Record<string, unknown> | null> {
  const project = await client.query(
    "SELECT company_id FROM projects WHERE project_id=$1",
    [lead.project_id],
  );
  if (!project.rowCount) return null;

  const companyId = Number(project.rows[0].company_id);
  const rules = await client.query(
    `SELECT * FROM routing_rules
     WHERE company_id=$1 AND is_active=TRUE
       AND (project_id IS NULL OR project_id=$2)
     ORDER BY priority, created_at, rule_id`,
    [companyId, lead.project_id],
  );
  const rule = rules.rows.find((candidate) =>
    matchesConditions(lead, candidate.conditions ?? {}),
  );
  if (!rule) return null;

  if (rule.action_type === "queue") {
    await client.query(
      `INSERT INTO queue_records (queue_id, lead_id, added_by)
       VALUES ($1,$2,$3)
       ON CONFLICT (lead_id) WHERE status='waiting' DO NOTHING`,
      [rule.target_queue_id, lead.lead_id, actorId],
    );
    return rule;
  }

  await createAssignment(
    client,
    {
      leadId: String(lead.lead_id),
      userId: rule.action_type === "user" ? String(rule.target_user_id) : null,
      teamId: rule.action_type === "team" ? String(rule.target_team_id) : null,
    },
    actorId,
    "auto_assigned",
  );
  return rule;
}
