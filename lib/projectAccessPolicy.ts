import { isSuperAdminRole } from "@/lib/systemRoles";

export function isCompanyWideProjectRole(roleKey: unknown) {
  return isSuperAdminRole(roleKey);
}

export function isLeadershipTeamName(name: unknown) {
  return String(name ?? "").trim().toLowerCase() === "leadership";
}

export function hasAuditLogAccess(input: {
  roleKey: unknown;
  teamName: unknown;
}) {
  return (
    isCompanyWideProjectRole(input.roleKey) ||
    isLeadershipTeamName(input.teamName)
  );
}

export function hasProjectWideLeadVisibility(input: {
  roleKey: string;
  teamName: string;
  permissions: readonly string[];
}) {
  return (
    isCompanyWideProjectRole(input.roleKey) ||
    isLeadershipTeamName(input.teamName) ||
    input.permissions.includes("LEADS_ASSIGN")
  );
}
