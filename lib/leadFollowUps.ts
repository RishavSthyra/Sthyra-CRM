import type { PoolClient } from "pg";

const DAY_MS = 24 * 60 * 60 * 1000;

export type CallFollowUpOutcome =
  | "interested"
  | "follow_up"
  | "no_answer"
  | "not_interested"
  | "wrong_number"
  | "voicemail"
  | "connected"
  | "callback_requested"
  | "qualified"
  | "do_not_call";

export type CallFollowUpPlan =
  | { action: "schedule"; dueAt: string; summary: string }
  | { action: "clear" }
  | { action: "unchanged" };

const ONE_DAY_OUTCOMES = new Set<CallFollowUpOutcome>([
  "no_answer",
  "voicemail",
]);
const TWO_DAY_OUTCOMES = new Set<CallFollowUpOutcome>([
  "interested",
  "follow_up",
  "connected",
]);
const CLEAR_OUTCOMES = new Set<CallFollowUpOutcome>([
  "not_interested",
  "wrong_number",
  "qualified",
  "do_not_call",
]);

function addDays(value: string | Date, days: number) {
  const date = new Date(value);
  return new Date(date.getTime() + days * DAY_MS).toISOString();
}

function summaryForOutcome(outcome: CallFollowUpOutcome | null) {
  switch (outcome) {
    case "no_answer":
      return "Retry call — no answer";
    case "voicemail":
      return "Retry call — voicemail left";
    case "interested":
      return "Follow up after interested response";
    case "follow_up":
      return "Scheduled sales follow-up call";
    case "connected":
      return "Continue sales conversation";
    case "callback_requested":
      return "Customer callback";
    default:
      return "Retry call — unable to connect";
  }
}

export function getCallFollowUpPlan(input: {
  outcome?: CallFollowUpOutcome | null;
  callStatus?: string | null;
  occurredAt: string | Date;
  requestedAt?: string | null;
}): CallFollowUpPlan {
  const outcome = input.outcome ?? null;

  if (outcome && CLEAR_OUTCOMES.has(outcome)) return { action: "clear" };

  if (outcome === "callback_requested") {
    return {
      action: "schedule",
      dueAt: input.requestedAt
        ? new Date(input.requestedAt).toISOString()
        : addDays(input.occurredAt, 1),
      summary: summaryForOutcome(outcome),
    };
  }

  if (outcome && ONE_DAY_OUTCOMES.has(outcome)) {
    return {
      action: "schedule",
      dueAt: addDays(input.occurredAt, 1),
      summary: summaryForOutcome(outcome),
    };
  }

  if (outcome && TWO_DAY_OUTCOMES.has(outcome)) {
    return {
      action: "schedule",
      dueAt: addDays(input.occurredAt, 2),
      summary: summaryForOutcome(outcome),
    };
  }

  if (
    !outcome &&
    ["no_answer", "busy", "missed", "failed"].includes(
      String(input.callStatus),
    )
  ) {
    return {
      action: "schedule",
      dueAt: addDays(input.occurredAt, 1),
      summary: summaryForOutcome(null),
    };
  }

  return { action: "unchanged" };
}

async function recordNextActionHistory(
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

async function scheduleCall(
  client: PoolClient,
  input: {
    leadId: string;
    dueAt: string;
    summary: string;
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
     ) VALUES ($1,'call',$2,$3,'pending',$4,$4)
     ON CONFLICT (lead_id) DO UPDATE SET
       action_type='call', summary=EXCLUDED.summary, due_at=EXCLUDED.due_at,
       status='pending', notes=NULL,
       updated_by=EXCLUDED.updated_by, updated_at=CURRENT_TIMESTAMP
     RETURNING *`,
    [input.leadId, input.summary, input.dueAt, input.actorUserId],
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
  if (!['active', 'nurture'].includes(String(lead.status))) return;
  await scheduleCall(client, {
    leadId: String(lead.lead_id),
    dueAt: new Date().toISOString(),
    summary: "Initial sales call",
    actorUserId,
    preservePending: true,
  });
}

export async function applyCallFollowUp(
  client: PoolClient,
  input: {
    leadId?: string | null;
    outcome?: CallFollowUpOutcome | null;
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

  if (!['active', 'nurture'].includes(String(lead.status))) {
    await clearLeadNextAction(client, input.leadId, input.actorUserId);
    return { action: "clear" } as CallFollowUpPlan;
  }

  const plan = getCallFollowUpPlan(input);
  if (plan.action === "schedule") {
    await scheduleCall(client, {
      leadId: input.leadId,
      dueAt: plan.dueAt,
      summary: plan.summary,
      actorUserId: input.actorUserId,
    });
  } else if (plan.action === "clear") {
    await clearLeadNextAction(client, input.leadId, input.actorUserId);
  }
  return plan;
}
