export const DEFAULT_PROJECT_OPPORTUNITY_STAGES = [
  {
    stage_key: "discovery",
    stage_name: "Discovery",
    probability: 25,
    color: "#8b9cf6",
    is_initial: true,
  },
  {
    stage_key: "shortlisting",
    stage_name: "Shortlisting",
    probability: 40,
    color: "#a98af7",
    is_initial: false,
  },
  {
    stage_key: "site_visit",
    stage_name: "Site Visit",
    probability: 55,
    color: "#e7aa51",
    is_initial: false,
  },
  {
    stage_key: "proposal",
    stage_name: "Proposal",
    probability: 70,
    color: "#ef83ad",
    is_initial: false,
  },
  {
    stage_key: "negotiation",
    stage_name: "Negotiation",
    probability: 82,
    color: "#59cfaa",
    is_initial: false,
  },
  {
    stage_key: "booking",
    stage_name: "Booking",
    probability: 92,
    color: "#75d5bc",
    is_initial: false,
  },
] as const;

export type OpportunityStageDefinition = {
  stage_key: string;
  stage_name: string;
  position: number;
  probability: number;
  color: string;
  is_initial: boolean;
};
