import type { PoolClient } from "pg";
import {
  type CallOutcome,
  followUpSummaryForCallOutcome,
  nextActionTypeForCallOutcome,
} from "@/lib/callOutcomes";

export type CallFollowUpPlan =
  | {
      action: "schedule";
      actionType: "call" | "review";
      dueAt: string;
      summary: string;
    }
  | { action: "clear" }
  | { action: "unchanged" };

export type ReopenedLeadCallPlan =
  | { action: "restore"; dueAt: string; summary: string }
  | { action: "schedule"; dueAt: string; summary: string }
  | { action: "unchanged" };

export function getReopenedLeadCallPlan(
  reopenedAt: string | Date = new Date(),
  previousAction: Record<string, unknown> | null = null,
): ReopenedLeadCallPlan {
  if (previousAction?.status === "pending") return { action: "unchanged" };
  const previousDueAt = previousAction?.due_at;
  const parsedPreviousDueAt =
    previousDueAt instanceof Date
      ? previousDueAt
      : typeof previousDueAt === "string"
        ? new Date(previousDueAt)
        : null;
  if (
    previousAction?.status === "cancelled" &&
    parsedPreviousDueAt &&
    !Number.isNaN(parsedPreviousDueAt.getTime()) &&
    typeof previousAction.summary === "string"
  ) {
    return {
      action: "restore",
      dueAt: parsedPreviousDueAt.toISOString(),
      summary: previousAction.summary,
    };
  }
  return {
    action: "schedule",
    dueAt: new Date(reopenedAt).toISOString(),
    summary: "Call reopened lead",
  };
}

export function getCallFollowUpPlan(input: {
  outcome?: CallOutcome | null;
  callStatus?: string | null;
  occurredAt: string | Date;
  requestedAt?: string | null;
}): CallFollowUpPlan {
  const outcome = input.outcome ?? null;
  if (outcome && input.requestedAt) {
    return {
      action: "schedule",
      actionType: nextActionTypeForCallOutcome(outcome),
      dueAt: new Date(input.requestedAt).toISOString(),
      summary: followUpSummaryForCallOutcome(outcome),
    };
  }

  if (outcome) {
    return { action: "clear" };
  }

  return { action: "unchanged" };
}

export async function recordNextActionHistory(
  client: PoolClient,
  leadId: string,
  previousAction: Record<string, unknown> | null,
  nextAction: Record<string, unknown>,
  actorUserId: string | null,
) {
  await client.query(
    `INSERT INTO lead_next_action_history (
       lead_id, previous_action, next_action, performed_by
     ) VALUES ($1,$2::jsonb,$3::jsonb,$4)`,
    [
      leadId,
      previousAction ? JSON.stringify(previousAction) : null,
      JSON.stringify(nextAction),
      actorUserId,
    ],
  );
}

async function scheduleNextAction(
  client: PoolClient,
  input: {
    leadId: string;
    dueAt: string;
    summary: string;
    actionType: "call" | "review";
    actorUserId: string | null;
    preservePending?: boolean;
  },
) {
  const previous = await client.query(
    "SELECT * FROM lead_next_actions WHERE lead_id=$1 FOR UPDATE",
    [input.leadId],
  );
  const previousAction = previous.rows[0] ?? null;
  if (input.preservePending && previousAction?.status === "pending") return;

  const result = await client.query(
    `INSERT INTO lead_next_actions (
       lead_id, action_type, summary, due_at, status, created_by, updated_by
     ) VALUES ($1,$2,$3,$4,'pending',$5,$5)
     ON CONFLICT (lead_id) DO UPDATE SET
       action_type=EXCLUDED.action_type, summary=EXCLUDED.summary,
       due_at=EXCLUDED.due_at,
       status='pending', notes=NULL,
       updated_by=EXCLUDED.updated_by, updated_at=CURRENT_TIMESTAMP
     RETURNING *`,
    [
      input.leadId,
      input.actionType,
      input.summary,
      input.dueAt,
      input.actorUserId,
    ],
  );
  await recordNextActionHistory(
    client,
    input.leadId,
    previousAction,
    result.rows[0],
    input.actorUserId,
  );
}

export async function clearLeadNextAction(
  client: PoolClient,
  leadId: string,
  actorUserId: string | null,
) {
  const previous = await client.query(
    "SELECT * FROM lead_next_actions WHERE lead_id=$1 FOR UPDATE",
    [leadId],
  );
  const previousAction = previous.rows[0] ?? null;
  if (!previousAction || previousAction.status !== "pending") return;

  const result = await client.query(
    `UPDATE lead_next_actions
     SET status='cancelled', updated_by=$2, updated_at=CURRENT_TIMESTAMP
     WHERE lead_id=$1
     RETURNING *`,
    [leadId, actorUserId],
  );
  await recordNextActionHistory(
    client,
    leadId,
    previousAction,
    result.rows[0],
    actorUserId,
  );
}

export async function ensureInitialLeadCall(
  client: PoolClient,
  lead: Record<string, unknown>,
  actorUserId: string | null,
) {
  if (!["active", "nurture"].includes(String(lead.status))) return;
  await scheduleNextAction(client, {
    leadId: String(lead.lead_id),
    dueAt: new Date().toISOString(),
    summary: "Initial sales call",
    actionType: "call",
    actorUserId,
    preservePending: true,
  });
}

export async function ensureReopenedLeadCall(
  client: PoolClient,
  lead: Record<string, unknown>,
  actorUserId: string | null,
) {
  if (String(lead.status) !== "active") return;
  const previous = await client.query(
    "SELECT * FROM lead_next_actions WHERE lead_id=$1 FOR UPDATE",
    [lead.lead_id],
  );
  const previousAction = previous.rows[0] ?? null;
  const plan = getReopenedLeadCallPlan(new Date(), previousAction);
  if (plan.action === "unchanged") return;
  if (plan.action === "restore") {
    const result = await client.query(
      `UPDATE lead_next_actions
       SET status='pending', updated_by=$2, updated_at=CURRENT_TIMESTAMP
       WHERE lead_id=$1
       RETURNING *`,
      [lead.lead_id, actorUserId],
    );
    await recordNextActionHistory(
      client,
      String(lead.lead_id),
      previousAction,
      result.rows[0],
      actorUserId,
    );
    return;
  }
  await scheduleNextAction(client, {
    leadId: String(lead.lead_id),
    dueAt: plan.dueAt,
    summary: plan.summary,
    actionType: "call",
    actorUserId,
    preservePending: true,
  });
}

export async function applyCallFollowUp(
  client: PoolClient,
  input: {
    leadId?: string | null;
    outcome?: CallOutcome | null;
    callStatus?: string | null;
    occurredAt: string | Date;
    requestedAt?: string | null;
    actorUserId: string | null;
  },
) {
  if (!input.leadId) return { action: "unchanged" } as CallFollowUpPlan;

  const leadResult = await client.query(
    "SELECT lead_id, status FROM leads WHERE lead_id=$1 FOR UPDATE",
    [input.leadId],
  );
  const lead = leadResult.rows[0];
  if (!lead) return { action: "unchanged" } as CallFollowUpPlan;

  if (!["active", "nurture"].includes(String(lead.status))) {
    await clearLeadNextAction(client, input.leadId, input.actorUserId);
    return { action: "clear" } as CallFollowUpPlan;
  }

  const plan = getCallFollowUpPlan(input);
  if (plan.action === "schedule") {
    await scheduleNextAction(client, {
      leadId: input.leadId,
      dueAt: plan.dueAt,
      summary: plan.summary,
      actionType: plan.actionType,
      actorUserId: input.actorUserId,
    });
  } else if (plan.action === "clear") {
    await clearLeadNextAction(client, input.leadId, input.actorUserId);
  }
  return plan;
}
