export type OpportunityOutcome = "won" | "lost";

export function closingProbability(outcome: OpportunityOutcome): number {
  return outcome === "won" ? 100 : 0;
}
