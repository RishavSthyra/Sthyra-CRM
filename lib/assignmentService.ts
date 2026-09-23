import type { PoolClient } from "pg";
import { addAssignmentHistory, matchesConditions } from "@/lib/operations";

export class OperationsReferenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OperationsReferenceError";
  }
}

export class OperationsConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OperationsConflictError";
  }
}

export async function getLeadContext(
  client: PoolClient,
  leadId: string,
  lock = false,
): Promise<Record<string, unknown> | null> {
  const result = await client.query(
    `SELECT l.*, p.company_id, s.stage_key
     FROM leads l
     JOIN projects p ON p.project_id=l.project_id
     LEFT JOIN project_lead_stages s ON s.stage_id=l.stage_id
     WHERE l.lead_id=$1${lock ? " FOR UPDATE OF l" : ""}`,
    [leadId],
  );
  return result.rows[0] ?? null;
}

export async function validateAssignmentTargets(
  client: PoolClient,
  companyId: number,
  projectId: number,
  userId?: string | null,
  teamId?: string | null,
  queueId?: string | null,
): Promise<void> {
  if (userId) {
    const user = await client.query(
      `SELECT u.user_id
       FROM users u JOIN teams t ON t.team_id=u.team_id
       WHERE u.user_id=$1 AND u.is_active=TRUE AND u.deleted_at IS NULL
         AND t.company_id=$2 AND t.is_active=TRUE
         AND (
           EXISTS (SELECT 1 FROM user_projects up WHERE up.user_id=u.user_id AND up.project_id=$3)
           OR EXISTS (SELECT 1 FROM team_projects tp WHERE tp.team_id=u.team_id AND tp.project_id=$3)
           OR NOT EXISTS (SELECT 1 FROM user_projects up WHERE up.user_id=u.user_id)
         )`,
      [userId, companyId, projectId],
    );
    if (!user.rowCount) {
      throw new OperationsReferenceError(
        "Assigned user must be active and have access to the lead project",
      );
    }
  }
  if (teamId) {
    const team = await client.query(
      `SELECT team_id FROM teams
       WHERE team_id=$1 AND company_id=$2 AND is_active=TRUE
         AND (
           EXISTS (SELECT 1 FROM team_projects tp WHERE tp.team_id=teams.team_id AND tp.project_id=$3)
           OR NOT EXISTS (SELECT 1 FROM team_projects tp WHERE tp.team_id=teams.team_id)
         )`,
      [teamId, companyId, projectId],
    );
    if (!team.rowCount) {
      throw new OperationsReferenceError(
        "Assigned team must be active and have access to the lead project",
      );
    }
  }
  if (queueId) {
    const queue = await client.query(
      `SELECT queue_id FROM queues
       WHERE queue_id=$1 AND company_id=$2 AND is_active=TRUE
         AND (project_id IS NULL OR project_id=$3)`,
      [queueId, companyId, projectId],
    );
    if (!queue.rowCount) {
      throw new OperationsReferenceError(
        "Queue must be active and available to the lead project",
      );
    }
  }
}

export async function startSlaInstancesForAssignment(
  client: PoolClient,
  assignment: Record<string, unknown>,
  lead: Record<string, unknown>,
): Promise<void> {
  const rules = await client.query(
    `SELECT * FROM sla_rules
     WHERE company_id=$1 AND applies_to='assignment' AND is_active=TRUE
       AND (project_id IS NULL OR project_id=$2)
     ORDER BY priority, created_at`,
    [assignment.company_id, assignment.project_id],
  );
  const candidate = { ...lead, ...assignment };
  for (const rule of rules.rows) {
    if (!matchesConditions(candidate, rule.conditions ?? {})) continue;
    const result = await client.query(
      `INSERT INTO sla_instances (
         sla_rule_id, company_id, project_id, assignment_id,
         response_due_at, resolution_due_at
       ) VALUES (
         $1,$2,$3,$4,
         CASE WHEN $5::integer IS NULL THEN NULL ELSE CURRENT_TIMESTAMP + ($5 * INTERVAL '1 minute') END,
         CASE WHEN $6::integer IS NULL THEN NULL ELSE CURRENT_TIMESTAMP + ($6 * INTERVAL '1 minute') END
       )
       ON CONFLICT DO NOTHING
       RETURNING sla_id`,
      [
        rule.sla_rule_id,
        assignment.company_id,
        assignment.project_id,
        assignment.assignment_id,
        rule.response_minutes,
        rule.resolution_minutes,
      ],
    );
    if (result.rowCount) {
      await client.query(
        `INSERT INTO sla_instance_history (sla_id, action, to_status)
         VALUES ($1, 'started', 'running')`,
        [result.rows[0].sla_id],
      );
    }
  }
}

export async function startSlaInstancesForLead(
  client: PoolClient,
  lead: Record<string, unknown>,
): Promise<void> {
  const project = await client.query(
    "SELECT company_id FROM projects WHERE project_id=$1",
    [lead.project_id],
  );
  if (!project.rowCount) return;
  const companyId = project.rows[0].company_id as number;
  const rules = await client.query(
    `SELECT * FROM sla_rules
     WHERE company_id=$1 AND applies_to='lead' AND is_active=TRUE
       AND (project_id IS NULL OR project_id=$2)
     ORDER BY priority, created_at`,
    [companyId, lead.project_id],
  );
  for (const rule of rules.rows) {
    if (!matchesConditions(lead, rule.conditions ?? {})) continue;
    const result = await client.query(
      `INSERT INTO sla_instances (
         sla_rule_id, company_id, project_id, lead_id,
         response_due_at, resolution_due_at
       ) VALUES (
         $1,$2,$3,$4,
         CASE WHEN $5::integer IS NULL THEN NULL ELSE CURRENT_TIMESTAMP + ($5 * INTERVAL '1 minute') END,
         CASE WHEN $6::integer IS NULL THEN NULL ELSE CURRENT_TIMESTAMP + ($6 * INTERVAL '1 minute') END
       )
       ON CONFLICT DO NOTHING
       RETURNING sla_id`,
      [
        rule.sla_rule_id,
        companyId,
        lead.project_id,
        lead.lead_id,
        rule.response_minutes,
        rule.resolution_minutes,
      ],
    );
    if (result.rowCount) {
      await client.query(
        "INSERT INTO sla_instance_history (sla_id, action, to_status) VALUES ($1, 'started', 'running')",
        [result.rows[0].sla_id],
      );
    }
  }
}

export async function createAssignment(
  client: PoolClient,
  input: {
    leadId: string;
    queueId?: string | null;
    userId?: string | null;
    teamId?: string | null;
    priority?: number;
    notes?: string | null;
  },
  actorId: string | null,
  historyAction = "created",
  initialStatus: "pending" | "accepted" = "pending",
): Promise<Record<string, unknown>> {
  const lead = await getLeadContext(client, input.leadId, true);
  if (!lead) throw new OperationsReferenceError("Lead not found");
  if (["closed", "duplicate", "invalid"].includes(String(lead.status))) {
    throw new OperationsConflictError(
      `Cannot assign a ${String(lead.status)} lead`,
    );
  }
  await validateAssignmentTargets(
    client,
    Number(lead.company_id),
    Number(lead.project_id),
    input.userId,
    input.teamId,
    input.queueId,
  );
  const result = await client.query(
    `INSERT INTO assignments (
       company_id, project_id, lead_id, queue_id, assigned_to_user_id,
       assigned_to_team_id, assigned_by, status, priority, notes, accepted_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
       CASE WHEN $8='accepted' THEN CURRENT_TIMESTAMP ELSE NULL END)
     RETURNING *`,
    [
      lead.company_id,
      lead.project_id,
      input.leadId,
      input.queueId ?? null,
      input.userId ?? null,
      input.teamId ?? null,
      actorId,
      initialStatus,
      input.priority ?? 0,
      input.notes ?? null,
    ],
  );
  const assignment = result.rows[0];
  await addAssignmentHistory(
    client,
    { ...assignment, status: null },
    historyAction,
    initialStatus,
    actorId,
    {
      userId: input.userId ?? null,
      teamId: input.teamId ?? null,
    },
  );
  if (initialStatus === "accepted") {
    await applyLeadOwnership(
      client,
      lead,
      input.userId ?? null,
      input.teamId ?? null,
      actorId,
      "assigned",
    );
  }
  if (input.queueId) {
    await client.query(
      `UPDATE queue_records
       SET status='assigned', assignment_id=$1, claimed_by=COALESCE(claimed_by,$2),
           claimed_at=COALESCE(claimed_at,CURRENT_TIMESTAMP), updated_at=CURRENT_TIMESTAMP
       WHERE queue_id=$3 AND lead_id=$4 AND status IN ('waiting','claimed')`,
      [assignment.assignment_id, actorId, input.queueId, input.leadId],
    );
  }
  await startSlaInstancesForAssignment(client, assignment, lead);
  return assignment;
}

export async function applyLeadOwnership(
  client: PoolClient,
  lead: Record<string, unknown>,
  userId: string | null,
  teamId: string | null,
  actorId: string | null,
  changeType: "assigned" | "transferred" | "unassigned",
): Promise<void> {
  if (lead.current_owner_user_id === userId && lead.current_team_id === teamId)
    return;
  await client.query(
    `UPDATE leads
     SET current_owner_user_id=$1, current_team_id=$2,
         assigned_at=CASE WHEN $1::uuid IS NULL AND $2::uuid IS NULL THEN NULL ELSE CURRENT_TIMESTAMP END,
         updated_at=CURRENT_TIMESTAMP
     WHERE lead_id=$3`,
    [userId, teamId, lead.lead_id],
  );
  await client.query(
    `INSERT INTO lead_ownership_history (
       lead_id, change_type, from_owner_user_id, to_owner_user_id,
       from_team_id, to_team_id, performed_by
     ) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [
      lead.lead_id,
      changeType,
      lead.current_owner_user_id ?? null,
      userId,
      lead.current_team_id ?? null,
      teamId,
      actorId,
    ],
  );
}

export async function chooseQueueAssignee(
  client: PoolClient,
  queue: Record<string, unknown>,
  requestedUserId?: string | null,
): Promise<string> {
  if (requestedUserId) {
    const member = await client.query(
      `SELECT qm.user_id FROM queue_members qm JOIN users u ON u.user_id=qm.user_id
       WHERE qm.queue_id=$1 AND qm.user_id=$2 AND qm.is_active=TRUE
         AND u.is_active=TRUE AND u.deleted_at IS NULL`,
      [queue.queue_id, requestedUserId],
    );
    if (!member.rowCount)
      throw new OperationsReferenceError(
        "Requested user is not an active queue member",
      );
    return requestedUserId;
  }
  let orderBy = "qm.position, qm.user_id";
  if (queue.assignment_strategy === "load_balanced") {
    orderBy = "active_assignments, qm.position, qm.user_id";
  } else if (queue.assignment_strategy === "round_robin") {
    orderBy = "(qm.user_id = $2::uuid), qm.position, qm.user_id";
  }
  const queryValues: unknown[] = [queue.queue_id];
  if (queue.assignment_strategy === "round_robin") {
    queryValues.push(queue.last_assigned_user_id ?? null);
  }
  const result = await client.query(
    `SELECT qm.user_id,
       COUNT(a.assignment_id) FILTER (WHERE a.status IN ('pending','accepted'))::integer AS active_assignments
     FROM queue_members qm
     JOIN users u ON u.user_id=qm.user_id
     LEFT JOIN assignments a ON a.assigned_to_user_id=qm.user_id
     WHERE qm.queue_id=$1 AND qm.is_active=TRUE
       AND u.is_active=TRUE AND u.deleted_at IS NULL
     GROUP BY qm.user_id, qm.position
     ORDER BY ${orderBy}
     LIMIT 1`,
    queryValues,
  );
  if (!result.rowCount)
    throw new OperationsConflictError("Queue has no available members");
  return result.rows[0].user_id as string;
}

export async function getQueueForUpdate(
  client: PoolClient,
  queueId: string,
): Promise<Record<string, unknown> | null> {
  const result = await client.query(
    "SELECT * FROM queues WHERE queue_id=$1 FOR UPDATE",
    [queueId],
  );
  return result.rows[0] ?? null;
}

export async function claimOrAssignNext(
  client: PoolClient,
  queue: Record<string, unknown>,
  actorId: string,
  options: {
    leadId?: string | null;
    userId?: string | null;
    autoAssign?: boolean;
  },
): Promise<Record<string, unknown>> {
  if (!queue.is_active) throw new OperationsConflictError("Queue is inactive");
  const values: unknown[] = [queue.queue_id];
  let leadFilter = "";
  if (options.leadId) {
    values.push(options.leadId);
    leadFilter = ` AND qr.lead_id=$${values.length}`;
  }
  const record = await client.query(
    `SELECT qr.* FROM queue_records qr
     WHERE qr.queue_id=$1 AND qr.status='waiting'
       AND qr.available_at <= CURRENT_TIMESTAMP${leadFilter}
     ORDER BY qr.priority DESC, qr.available_at, qr.created_at
     FOR UPDATE SKIP LOCKED LIMIT 1`,
    values,
  );
  if (!record.rowCount)
    throw new OperationsConflictError("No available queue records");
  const assignee = options.autoAssign
    ? await chooseQueueAssignee(client, queue, options.userId)
    : actorId;
  const assignment = await createAssignment(
    client,
    {
      leadId: record.rows[0].lead_id,
      queueId: queue.queue_id as string,
      userId: assignee,
      teamId: (queue.team_id as string | null) ?? null,
      priority: record.rows[0].priority,
    },
    actorId,
    options.autoAssign ? "auto_assigned" : "claimed",
    "accepted",
  );
  await client.query(
    "UPDATE queues SET last_assigned_user_id=$1, updated_at=CURRENT_TIMESTAMP WHERE queue_id=$2",
    [assignee, queue.queue_id],
  );
  return assignment;
}
