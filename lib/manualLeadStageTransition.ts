export type ManualLeadStage = {
  stage_key: string;
  stage_name?: string | null;
  position?: number | null;
  is_terminal?: boolean | null;
};

export type ManualStageDirection =
  | "forward"
  | "backward"
  | "same"
  | "unknown";

const COMMAND_MANAGED_STAGE_KEYS = new Set(["qualified", "nurturing"]);

function normalizedStageKey(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

export function isCommandManagedLeadStage(stageKey: unknown) {
  return COMMAND_MANAGED_STAGE_KEYS.has(normalizedStageKey(stageKey));
}

export function getManualStageDirection(
  currentPosition: unknown,
  targetPosition: unknown,
): ManualStageDirection {
  if (
    currentPosition === undefined ||
    currentPosition === null ||
    currentPosition === "" ||
    targetPosition === undefined ||
    targetPosition === null ||
    targetPosition === ""
  ) {
    return "unknown";
  }
  const current = Number(currentPosition);
  const target = Number(targetPosition);
  if (!Number.isFinite(current) || !Number.isFinite(target)) return "unknown";
  if (target === current) return "same";
  return target > current ? "forward" : "backward";
}

export function evaluateManualLeadStageTransition(input: {
  currentStage: ManualLeadStage | null;
  targetStage: ManualLeadStage;
  canMoveBackward: boolean;
}):
  | { ok: true; direction: Exclude<ManualStageDirection, "same"> }
  | { ok: false; direction: ManualStageDirection; error: string; status: number } {
  const targetKey = normalizedStageKey(input.targetStage.stage_key);
  const currentKey = normalizedStageKey(input.currentStage?.stage_key);
  const direction = getManualStageDirection(
    input.currentStage?.position,
    input.targetStage.position,
  );

  if (input.targetStage.is_terminal) {
    return {
      ok: false,
      direction,
      error: "Use the close action for terminal stages",
      status: 422,
    };
  }
  if (targetKey === "qualified") {
    return {
      ok: false,
      direction,
      error: "Use the Qualify action to convert this lead",
      status: 422,
    };
  }
  if (targetKey === "nurturing") {
    return {
      ok: false,
      direction,
      error: "Use the Move to nurture action for this stage",
      status: 422,
    };
  }
  if (targetKey && targetKey === currentKey) {
    return {
      ok: false,
      direction: "same",
      error: "The lead is already in this stage",
      status: 409,
    };
  }
  if (direction === "backward" && !input.canMoveBackward) {
    return {
      ok: false,
      direction,
      error: "Moving a lead backward requires project management permission",
      status: 403,
    };
  }
  return { ok: true, direction: direction === "same" ? "unknown" : direction };
}

