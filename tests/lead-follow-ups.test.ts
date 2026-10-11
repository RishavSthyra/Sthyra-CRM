import assert from "node:assert/strict";
import test from "node:test";
import { getCallFollowUpPlan } from "../lib/leadFollowUps";
import { validateDisposition } from "../lib/telephony";

const callTime = "2026-10-11T06:30:00.000Z";

test("unanswered calls are retried one day after the call", () => {
  assert.deepEqual(
    getCallFollowUpPlan({ outcome: "no_answer", occurredAt: callTime }),
    {
      action: "schedule",
      dueAt: "2026-10-12T06:30:00.000Z",
      summary: "Retry call — no answer",
    },
  );
  assert.deepEqual(
    getCallFollowUpPlan({ callStatus: "busy", occurredAt: callTime }),
    {
      action: "schedule",
      dueAt: "2026-10-12T06:30:00.000Z",
      summary: "Retry call — unable to connect",
    },
  );
});

test("answered conversations are followed up two days later", () => {
  for (const outcome of ["interested", "follow_up", "connected"] as const) {
    const plan = getCallFollowUpPlan({ outcome, occurredAt: callTime });
    assert.equal(plan.action, "schedule");
    if (plan.action === "schedule") {
      assert.equal(plan.dueAt, "2026-10-13T06:30:00.000Z");
    }
  }
});

test("callback requests use the promised time and otherwise default to tomorrow", () => {
  assert.deepEqual(
    getCallFollowUpPlan({
      outcome: "callback_requested",
      occurredAt: callTime,
      requestedAt: "2026-10-15T04:30:00.000Z",
    }),
    {
      action: "schedule",
      dueAt: "2026-10-15T04:30:00.000Z",
      summary: "Customer callback",
    },
  );
  const fallback = getCallFollowUpPlan({
    outcome: "callback_requested",
    occurredAt: callTime,
  });
  assert.equal(
    fallback.action === "schedule" ? fallback.dueAt : null,
    "2026-10-12T06:30:00.000Z",
  );
});

test("terminal pre-sales outcomes clear the call queue", () => {
  for (const outcome of [
    "qualified",
    "not_interested",
    "wrong_number",
    "do_not_call",
  ] as const) {
    assert.deepEqual(getCallFollowUpPlan({ outcome, occurredAt: callTime }), {
      action: "clear",
    });
  }
});

test("a completed call without a disposition does not guess the next action", () => {
  assert.deepEqual(
    getCallFollowUpPlan({ callStatus: "completed", occurredAt: callTime }),
    { action: "unchanged" },
  );
});

test("disposition validation accepts an exact callback time", () => {
  assert.deepEqual(
    validateDisposition({
      outcome: "callback_requested",
      summary: "Asked us to call after lunch",
      next_follow_up_at: "2026-10-15T10:00:00+05:30",
    }),
    {
      ok: true,
      data: {
        outcome: "callback_requested",
        summary: "Asked us to call after lunch",
        next_follow_up_at: "2026-10-15T04:30:00.000Z",
      },
    },
  );
});

test("disposition validation rejects unknown and invalid scheduling fields", () => {
  const result = validateDisposition({
    outcome: "no_answer",
    next_follow_up_at: "later",
    unsupported: true,
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.ok(result.errors.includes("Unknown field: unsupported"));
    assert.ok(
      result.errors.includes(
        "next_follow_up_at must be a valid ISO date-time or null",
      ),
    );
  }
});
