export const ADMIN_ROLE_KEYS = new Set([
  "COMPANY_OWNER",
  "COMPANY_ADMIN",
  "SUPER_ADMIN",
]);

export type WorkspaceModule =
  | "leads"
  | "opportunities"
  | "activity"
  | "calendar"
  | "inventory"
  | "marketing"
  | "transfers"
  | "people";

const MODULE_PERMISSIONS: Record<WorkspaceModule, string> = {
  leads: "LEADS_VIEW",
  opportunities: "OPPORTUNITIES_MANAGE",
  activity: "ACTIVITIES_MANAGE",
  calendar: "ACTIVITIES_MANAGE",
  inventory: "INVENTORY_MANAGE",
  marketing: "WORKSPACE_MANAGE",
  transfers: "LEADS_ASSIGN",
  people: "PEOPLE_MANAGE",
};

export function canAccessWorkspaceModule(
  roleKey: string | null | undefined,
  permissions: readonly string[] | null | undefined,
  module: WorkspaceModule,
): boolean {
  const normalizedRole = roleKey?.trim().toUpperCase() ?? "";
  if (ADMIN_ROLE_KEYS.has(normalizedRole)) return true;
  return (permissions ?? []).includes(MODULE_PERMISSIONS[module]);
}
