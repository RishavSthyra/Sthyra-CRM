const FOLLOW_UP_PRIORITY = `
  CASE
    WHEN next_action.status='pending' AND next_action.due_at <= CURRENT_TIMESTAMP THEN 0
    WHEN next_action.status='pending' AND next_action.due_at <= CURRENT_TIMESTAMP + INTERVAL '2 days' THEN 1
    WHEN next_action.status='pending' THEN 2
    ELSE 3
  END,
  CASE WHEN next_action.status='pending' THEN next_action.due_at END ASC NULLS LAST`;

export function shouldPrioritizeLeadFollowUps(stageKey: string | null) {
  return Boolean(stageKey && stageKey !== "new");
}

export function buildLeadListOrderBy(
  stageKey: string | null,
  selectedOrderBy: string,
) {
  return shouldPrioritizeLeadFollowUps(stageKey)
    ? `${FOLLOW_UP_PRIORITY}, ${selectedOrderBy}`
    : selectedOrderBy;
}
