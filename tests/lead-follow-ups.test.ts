import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  CALL_OUTCOMES,
  callOutcomeRequiresFollowUp,
  canMoveLeadToDeadFromCall,
  leadStageForCallOutcome,
  validateManualFollowUpAt,
} from "../lib/callOutcomes";
import { validateCallPayload } from "../lib/communications";
import { shouldAdvanceLeadStage } from "../lib/leadCallWorkflow";
import {
  getCallFollowUpPlan,
  getReopenedLeadCallPlan,
} from "../lib/leadFollowUps";
import { validateDisposition } from "../lib/telephony";

const callTime = "2026-10-11T06:30:00.000Z";
const futureFollowUp = "2099-10-15T04:30:00.000Z";
const leadId = "9f9ff7ea-4401-4a0e-9199-96d68bc804ad";

test("every supported call outcome uses the exact manual follow-up", () => {
  for (const outcome of CALL_OUTCOMES) {
    const plan = getCallFollowUpPlan({
      outcome,
      occurredAt: callTime,
      requestedAt: futureFollowUp,
    });
    assert.equal(plan.action, "schedule");
    if (plan.action === "schedule") {
      assert.equal(plan.dueAt, futureFollowUp);
      assert.equal(
        plan.actionType,
        canMoveLeadToDeadFromCall(outcome) ? "review" : "call",
      );
    }
  }
});

test("follow-up planning never guesses a date", () => {
  assert.deepEqual(
    getCallFollowUpPlan({ outcome: "no_answer", occurredAt: callTime }),
    { action: "unchanged" },
  );
  assert.deepEqual(
    getCallFollowUpPlan({ callStatus: "busy", occurredAt: callTime }),
    { action: "unchanged" },
  );
});

test("call outcomes map to forward pipeline stages", () => {
  for (const outcome of ["no_answer", "voicemail", "wrong_number"] as const) {
    assert.equal(leadStageForCallOutcome(outcome), "contact_attempted");
  }
  for (const outcome of [
    "connected",
    "interested",
    "not_interested",
    "do_not_call",
  ] as const) {
    assert.equal(leadStageForCallOutcome(outcome), "contacted");
  }
});

test("call outcomes can only move a lead forward", () => {
  assert.equal(shouldAdvanceLeadStage(1, 2), true);
  assert.equal(shouldAdvanceLeadStage(2, 2), false);
  assert.equal(shouldAdvanceLeadStage(4, 2), false);
  assert.equal(shouldAdvanceLeadStage(null, 2), true);
  assert.equal(shouldAdvanceLeadStage(1, undefined), false);
});

test("only terminal call outcomes offer the optional Dead transition", () => {
  for (const outcome of CALL_OUTCOMES) {
    assert.equal(
      canMoveLeadToDeadFromCall(outcome),
      ["not_interested", "wrong_number", "do_not_call"].includes(outcome),
    );
  }
});

test("manual follow-up validation requires a future date", () => {
  assert.deepEqual(validateManualFollowUpAt(undefined, callTime), {
    ok: false,
    error: "next_follow_up_at is required when recording a lead call",
  });
  assert.equal(validateManualFollowUpAt("later", callTime).ok, false);
  assert.equal(validateManualFollowUpAt(callTime, callTime).ok, false);
  assert.deepEqual(validateManualFollowUpAt(futureFollowUp, callTime), {
    ok: true,
    value: futureFollowUp,
  });
});

test("terminal call outcomes make the next follow-up optional", () => {
  for (const outcome of [
    "not_interested",
    "wrong_number",
    "do_not_call",
  ] as const) {
    assert.equal(callOutcomeRequiresFollowUp(outcome), false);
    const result = validateCallPayload({
      project_id: 1,
      lead_id: leadId,
      direction: "outbound",
      status: "completed",
      outcome,
      phone_number: "+919999999999",
      subject: "Pre-sales call",
      started_at: callTime,
      ended_at: callTime,
    });
    assert.equal(result.ok, true);
  }
  for (const outcome of [
    "connected",
    "interested",
    "no_answer",
    "voicemail",
  ] as const) {
    assert.equal(callOutcomeRequiresFollowUp(outcome), true);
  }
});

test("terminal outcomes without a date clear stale follow-ups", () => {
  for (const outcome of [
    "not_interested",
    "wrong_number",
    "do_not_call",
  ] as const) {
    assert.deepEqual(
      getCallFollowUpPlan({ outcome, occurredAt: callTime }),
      { action: "clear" },
    );
  }
});

test("lead call payload requires the manual follow-up", () => {
  const base = {
    project_id: 1,
    lead_id: leadId,
    direction: "outbound",
    status: "completed",
    outcome: "connected",
    phone_number: "+919999999999",
    subject: "Pre-sales call",
    started_at: callTime,
    ended_at: callTime,
  };
  const missing = validateCallPayload(base);
  assert.equal(missing.ok, false);
  if (!missing.ok) {
    assert.ok(
      missing.errors.includes(
        "next_follow_up_at is required when recording a lead call",
      ),
    );
  }

  const valid = validateCallPayload({
    ...base,
    next_follow_up_at: futureFollowUp,
  });
  assert.equal(valid.ok, true);
});

test("legacy workflow labels are rejected as call outcomes", () => {
  for (const outcome of ["follow_up", "callback_requested", "qualified"]) {
    const result = validateDisposition({
      outcome,
      next_follow_up_at: futureFollowUp,
    });
    assert.equal(result.ok, false);
  }
});

test("the call payload rejects every legacy workflow label", () => {
  for (const outcome of ["follow_up", "callback_requested"]) {
    const result = validateCallPayload({
      project_id: 1,
      lead_id: leadId,
      direction: "outbound",
      status: "completed",
      outcome,
      phone_number: "+919999999999",
      subject: "Pre-sales call",
      started_at: callTime,
      ended_at: callTime,
      next_follow_up_at: futureFollowUp,
    });
    assert.equal(result.ok, false);
  }
});

test("Dead selection is accepted only for eligible outcomes", () => {
  const eligible = validateDisposition({
    outcome: "wrong_number",
    next_follow_up_at: futureFollowUp,
    mark_lead_dead: true,
  });
  assert.equal(eligible.ok, true);

  const ineligible = validateDisposition({
    outcome: "connected",
    next_follow_up_at: futureFollowUp,
    mark_lead_dead: true,
  });
  assert.equal(ineligible.ok, false);
});

test("reopening a lead restores its previously cancelled follow-up", () => {
  assert.deepEqual(
    getReopenedLeadCallPlan(callTime, {
      status: "cancelled",
      due_at: "2026-10-13T10:04:25.854Z",
      summary: "Initial sales call",
    }),
    {
      action: "restore",
      dueAt: "2026-10-13T10:04:25.854Z",
      summary: "Initial sales call",
    },
  );
});

test("reopening preserves a pending call and creates one only when absent", () => {
  assert.deepEqual(
    getReopenedLeadCallPlan(callTime, {
      status: "pending",
      due_at: "2026-10-13T10:04:25.854Z",
      summary: "Initial sales call",
    }),
    { action: "unchanged" },
  );
  assert.deepEqual(getReopenedLeadCallPlan(callTime), {
    action: "schedule",
    dueAt: callTime,
    summary: "Call reopened lead",
  });
});

test("call workflow is wired atomically through both call endpoints", () => {
  const createRoute = readFileSync("app/api/calls/route.ts", "utf8");
  const dispositionRoute = readFileSync(
    "app/api/calls/[callid]/disposition/route.ts",
    "utf8",
  );
  for (const source of [createRoute, dispositionRoute]) {
    assert.match(source, /applyLeadCallWorkflow/);
    assert.match(source, /await client\.query\("COMMIT"\)/);
  }
});

test("the lead call form exposes only real outcomes and requires follow-up", () => {
  const leadsPage = readFileSync("app/leads/page.tsx", "utf8");
  assert.doesNotMatch(leadsPage, /value:\s*"follow_up"/);
  assert.doesNotMatch(leadsPage, /value:\s*"callback_requested"/);
  assert.match(leadsPage, /Next follow-up/);
  assert.match(leadsPage, /required=\{callOutcomeRequiresFollowUp/);
  assert.match(leadsPage, /\(optional\)/);
  assert.doesNotMatch(leadsPage, /This outcome advances an eligible lead/);
  assert.doesNotMatch(leadsPage, /Choose the exact date and time/);
  assert.match(leadsPage, /Move this lead to Dead\?/);
});

test("manual follow-up workflow remains deterministic under load", () => {
  const iterations = 50_000;
  for (let index = 0; index < iterations; index += 1) {
    const outcome = CALL_OUTCOMES[index % CALL_OUTCOMES.length];
    const plan = getCallFollowUpPlan({
      outcome,
      occurredAt: callTime,
      requestedAt: futureFollowUp,
    });
    assert.equal(plan.action, "schedule");
    assert.ok(
      leadStageForCallOutcome(outcome) === "contact_attempted" ||
        leadStageForCallOutcome(outcome) === "contacted",
    );
  }
});

test("call API validation remains stable under mixed-outcome load", () => {
  const iterations = 20_000;
  for (let index = 0; index < iterations; index += 1) {
    const outcome = CALL_OUTCOMES[index % CALL_OUTCOMES.length];
    const result = validateCallPayload({
      project_id: 1,
      lead_id: leadId,
      direction: "outbound",
      status: outcome === "no_answer" ? "no_answer" : "completed",
      outcome,
      phone_number: "+919999999999",
      subject: "Pre-sales call",
      started_at: callTime,
      ended_at: callTime,
      next_follow_up_at: futureFollowUp,
      mark_lead_dead:
        canMoveLeadToDeadFromCall(outcome) && index % 2 === 0,
    });
    assert.equal(result.ok, true);
  }
});
