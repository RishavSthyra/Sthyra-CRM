import type { PoolClient } from "pg";
import {
  chooseQueueAssignee,
  createAssignment,
  OperationsConflictError,
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
    `SELECT p.company_id,
       COALESCE(configuration.auto_assignment_enabled, FALSE) AS auto_assignment_enabled
     FROM projects p
     LEFT JOIN project_lead_configurations configuration
       ON configuration.project_id=p.project_id
     WHERE p.project_id=$1`,
    [lead.project_id],
  );
  if (!project.rowCount) return null;

  const companyId = Number(project.rows[0].company_id);
  const autoAssignmentEnabled = Boolean(
    project.rows[0].auto_assignment_enabled,
  );
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

    if (!autoAssignmentEnabled) return rule;

    const queueResult = await client.query(
      "SELECT * FROM queues WHERE queue_id=$1 AND is_active=TRUE FOR UPDATE",
      [rule.target_queue_id],
    );
    const queue = queueResult.rows[0];
    if (!queue || queue.assignment_strategy === "manual") return rule;

    try {
      const assignee = await chooseQueueAssignee(client, queue);
      await createAssignment(
        client,
        {
          leadId: String(lead.lead_id),
          queueId: String(queue.queue_id),
          userId: assignee,
          teamId: (queue.team_id as string | null) ?? null,
        },
        actorId,
        "auto_assigned",
        "accepted",
      );
      await client.query(
        `UPDATE queues
         SET last_assigned_user_id=$1, updated_at=CURRENT_TIMESTAMP
         WHERE queue_id=$2`,
        [assignee, queue.queue_id],
      );
    } catch (error) {
      // Never reject a real lead because every queue member is unavailable.
      // The lead remains waiting in the queue and can be claimed later.
      if (!(error instanceof OperationsConflictError)) throw error;
    }
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
    autoAssignmentEnabled ? "accepted" : "pending",
  );
  return rule;
}
