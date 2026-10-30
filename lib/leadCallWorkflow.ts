import type { PoolClient } from "pg";
import {
  type CallOutcome,
  canMoveLeadToDeadFromCall,
  leadStageForCallOutcome,
} from "@/lib/callOutcomes";
import { getProjectStage, lockLead, transitionLead } from "@/lib/leadCommands";
import {
  applyCallFollowUp,
  clearLeadNextAction,
  type CallFollowUpPlan,
} from "@/lib/leadFollowUps";

type LeadCallWorkflowResult = {
  followUp: CallFollowUpPlan;
  lead: Record<string, unknown> | null;
  markedDead: boolean;
  stageKey: string | null;
};

const MUTABLE_LEAD_STATUSES = new Set(["active", "nurture"]);

export function shouldAdvanceLeadStage(
  currentPosition: unknown,
  targetPosition: unknown,
): boolean {
  const target = Number(targetPosition);
  if (!Number.isFinite(target)) return false;
  if (currentPosition === undefined || currentPosition === null) return true;
  const current = Number(currentPosition);
  return Number.isFinite(current) && current < target;
}

async function advanceLeadForCallOutcome(
  client: PoolClient,
  lead: Record<string, unknown>,
  outcome: CallOutcome,
  callId: string,
  actorUserId: string | null,
): Promise<{ lead: Record<string, unknown>; stageKey: string | null }> {
  const targetStageKey = leadStageForCallOutcome(outcome);
  const targetStage = await getProjectStage(
    client,
    Number(lead.project_id),
    targetStageKey,
  );
  if (!targetStage) return { lead, stageKey: null };

  const currentStage = lead.stage_id
    ? await client.query(
        `SELECT position
         FROM project_lead_stages
         WHERE stage_id=$1 AND project_id=$2 AND is_active=TRUE`,
        [lead.stage_id, lead.project_id],
      )
    : null;
  const targetPosition = await client.query(
    `SELECT position
     FROM project_lead_stages
     WHERE stage_id=$1 AND project_id=$2 AND is_active=TRUE`,
    [targetStage.stage_id, lead.project_id],
  );
  const currentPosition = currentStage?.rows[0]?.position;
  const nextPosition = targetPosition.rows[0]?.position;

  if (!shouldAdvanceLeadStage(currentPosition, nextPosition)) {
    return { lead, stageKey: null };
  }

  const updated = await transitionLead(
    client,
    lead,
    "call_outcome_stage",
    String(lead.status),
    String(targetStage.stage_id),
    {},
    {
      call_id: callId,
      call_outcome: outcome,
      stage_key: targetStageKey,
    },
    actorUserId,
  );
  return { lead: updated, stageKey: targetStageKey };
}

export async function applyLeadCallWorkflow(
  client: PoolClient,
  input: {
    leadId?: string | null;
    callId: string;
    outcome: CallOutcome;
    occurredAt: string | Date;
    nextFollowUpAt?: string | null;
    markLeadDead: boolean;
    summary?: string | null;
    actorUserId: string | null;
  },
): Promise<LeadCallWorkflowResult> {
  if (!input.leadId) {
    return {
      followUp: { action: "unchanged" },
      lead: null,
      markedDead: false,
      stageKey: null,
    };
  }

  let lead = await lockLead(client, input.leadId);
  if (!lead) {
    return {
      followUp: { action: "unchanged" },
      lead: null,
      markedDead: false,
      stageKey: null,
    };
  }

  if (!MUTABLE_LEAD_STATUSES.has(String(lead.status))) {
    await clearLeadNextAction(client, input.leadId, input.actorUserId);
    return {
      followUp: { action: "clear" },
      lead,
      markedDead: false,
      stageKey: null,
    };
  }

  const stageChange = await advanceLeadForCallOutcome(
    client,
    lead,
    input.outcome,
    input.callId,
    input.actorUserId,
  );
  lead = stageChange.lead;

  if (input.markLeadDead) {
    if (!canMoveLeadToDeadFromCall(input.outcome)) {
      throw new Error("CALL_OUTCOME_CANNOT_MOVE_LEAD_TO_DEAD");
    }
    const closed = await transitionLead(
      client,
      lead,
      "close_from_call_outcome",
      "closed",
      (lead.stage_id as string | null) ?? null,
      {
        closing_notes:
          input.summary?.trim() ||
          `Moved to Dead after call outcome: ${input.outcome}`,
        closed_at: new Date(),
      },
      {
        call_id: input.callId,
        call_outcome: input.outcome,
        source: "call_outcome",
      },
      input.actorUserId,
    );
    return {
      followUp: { action: "clear" },
      lead: closed,
      markedDead: true,
      stageKey: stageChange.stageKey,
    };
  }

  const followUp = await applyCallFollowUp(client, {
    leadId: input.leadId,
    outcome: input.outcome,
    callStatus: null,
    occurredAt: input.occurredAt,
    requestedAt: input.nextFollowUpAt,
    actorUserId: input.actorUserId,
  });
  return {
    followUp,
    lead,
    markedDead: false,
    stageKey: stageChange.stageKey,
  };
}
