export const DEFAULT_PROJECT_LEAD_STAGES = [
  {
    stage_key: "new",
    stage_name: "New",
    is_initial: true,
    is_terminal: false,
  },
  {
    stage_key: "contact_attempted",
    stage_name: "Contact Attempted",
    is_initial: false,
    is_terminal: false,
  },
  {
    stage_key: "contacted",
    stage_name: "Contacted",
    is_initial: false,
    is_terminal: false,
  },
  {
    stage_key: "nurturing",
    stage_name: "Nurturing",
    is_initial: false,
    is_terminal: false,
  },
  {
    stage_key: "qualified",
    stage_name: "Qualified / Converted",
    is_initial: false,
    is_terminal: false,
  },
] as const;
