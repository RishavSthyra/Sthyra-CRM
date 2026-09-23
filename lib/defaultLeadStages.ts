export const DEFAULT_PROJECT_LEAD_STAGES = [
  {
    stage_key: "new",
    stage_name: "New",
    is_initial: true,
    is_terminal: false,
  },
  {
    stage_key: "contacted",
    stage_name: "Contacted",
    is_initial: false,
    is_terminal: false,
  },
  {
    stage_key: "qualified",
    stage_name: "Qualified",
    is_initial: false,
    is_terminal: false,
  },
  {
    stage_key: "site_visit_scheduled",
    stage_name: "Site Visit Scheduled",
    is_initial: false,
    is_terminal: false,
  },
  {
    stage_key: "site_visit_completed",
    stage_name: "Site Visit Completed",
    is_initial: false,
    is_terminal: false,
  },
  {
    stage_key: "negotiation",
    stage_name: "Negotiation",
    is_initial: false,
    is_terminal: false,
  },
  {
    stage_key: "booking_pending",
    stage_name: "Booking Pending",
    is_initial: false,
    is_terminal: false,
  },
  {
    stage_key: "booked",
    stage_name: "Booked",
    is_initial: false,
    is_terminal: false,
  },
  {
    stage_key: "won",
    stage_name: "Won",
    is_initial: false,
    is_terminal: true,
  },
  {
    stage_key: "lost",
    stage_name: "Lost",
    is_initial: false,
    is_terminal: true,
  },
] as const;
