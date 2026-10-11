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

const MODULE_ROUTES: Array<{
  route: string;
  module: WorkspaceModule;
}> = [
  { route: "/opportunities", module: "opportunities" },
  { route: "/team-members", module: "people" },
  { route: "/inventory", module: "inventory" },
  { route: "/marketing", module: "marketing" },
  { route: "/transfers", module: "transfers" },
  { route: "/activity", module: "activity" },
  { route: "/calendar", module: "calendar" },
  { route: "/leads", module: "leads" },
];

export function canAccessWorkspaceModule(
  roleKey: string | null | undefined,
  permissions: readonly string[] | null | undefined,
  module: WorkspaceModule,
): boolean {
  if (isSuperAdminRole(roleKey)) return true;
  return (permissions ?? []).includes(MODULE_PERMISSIONS[module]);
}

export function workspaceModuleForPathname(
  pathname: string,
): WorkspaceModule | null {
  return (
    MODULE_ROUTES.find(
      ({ route }) =>
        pathname === route || pathname.startsWith(`${route}/`),
    )?.module ?? null
  );
}
