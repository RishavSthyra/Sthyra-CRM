export const CALL_OUTCOMES = [
  "connected",
  "interested",
  "no_answer",
  "voicemail",
  "not_interested",
  "wrong_number",
  "do_not_call",
] as const;

export type CallOutcome = (typeof CALL_OUTCOMES)[number];

const OPTIONAL_DEAD_OUTCOMES = new Set<CallOutcome>([
  "not_interested",
  "wrong_number",
  "do_not_call",
]);

const CONTACT_ATTEMPTED_OUTCOMES = new Set<CallOutcome>([
  "no_answer",
  "voicemail",
  "wrong_number",
]);

export function isCallOutcome(value: unknown): value is CallOutcome {
  return CALL_OUTCOMES.includes(value as CallOutcome);
}

export function canMoveLeadToDeadFromCall(outcome: CallOutcome): boolean {
  return OPTIONAL_DEAD_OUTCOMES.has(outcome);
}

export function leadStageForCallOutcome(
  outcome: CallOutcome,
): "contact_attempted" | "contacted" {
  return CONTACT_ATTEMPTED_OUTCOMES.has(outcome)
    ? "contact_attempted"
    : "contacted";
}

export function nextActionTypeForCallOutcome(
  outcome: CallOutcome,
): "call" | "review" {
  return OPTIONAL_DEAD_OUTCOMES.has(outcome) ? "review" : "call";
}

export function followUpSummaryForCallOutcome(outcome: CallOutcome): string {
  switch (outcome) {
    case "connected":
      return "Follow up after answered call";
    case "interested":
      return "Continue interested sales conversation";
    case "no_answer":
      return "Retry call — no answer";
    case "voicemail":
      return "Retry call — voicemail left";
    case "not_interested":
      return "Review lead after not-interested response";
    case "wrong_number":
      return "Review lead contact details — wrong number";
    case "do_not_call":
      return "Review do-not-call lead without calling";
  }
}

export function validateManualFollowUpAt(
  value: unknown,
  now: string | Date | number = Date.now(),
): { ok: true; value: string } | { ok: false; error: string } {
  if (typeof value !== "string" || !value.trim()) {
    return {
      ok: false,
      error: "next_follow_up_at is required when recording a lead call",
    };
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return {
      ok: false,
      error: "next_follow_up_at must be a valid ISO date-time",
    };
  }
  if (parsed.getTime() <= new Date(now).getTime()) {
    return {
      ok: false,
      error: "next_follow_up_at must be in the future",
    };
  }
  return { ok: true, value: parsed.toISOString() };
}
