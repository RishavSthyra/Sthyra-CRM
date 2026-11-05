import { isCommandManagedLeadStage } from "@/lib/manualLeadStageTransition";

export function isLeadStageAvailableForManualCreation(stage: {
  stage_key?: unknown;
  is_terminal?: unknown;
}) {
  return (
    stage.is_terminal !== true &&
    !isCommandManagedLeadStage(stage.stage_key)
  );
}
