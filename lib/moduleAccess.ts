import { isSuperAdminRole } from "@/lib/systemRoles";

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
  if (isSuperAdminRole(roleKey)) return true;
  return (permissions ?? []).includes(MODULE_PERMISSIONS[module]);
}
