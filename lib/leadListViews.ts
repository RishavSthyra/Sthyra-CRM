export const DEAD_LEAD_STATUSES = ["closed", "duplicate", "invalid"] as const;

export const DEAD_LEADS_TAB_KEY = "__dead_leads__";

export function isDeadLeadStatus(status?: string | null) {
  return DEAD_LEAD_STATUSES.includes(
    status as (typeof DEAD_LEAD_STATUSES)[number],
  );
}

export function getLeadListView(
  stage: string,
): { stageKey?: string; view?: "dead" } {
  if (stage === DEAD_LEADS_TAB_KEY) {
    return { view: "dead" as const };
  }
  if (stage === "all") return {};
  return { stageKey: stage };
}

export function getLeadStatusLabel(input: {
  status?: string | null;
  temperature?: string | null;
  stageName?: string | null;
}) {
  if (isDeadLeadStatus(input.status)) return input.status!;
  return input.temperature || input.stageName || input.status || "active";
}
