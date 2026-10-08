const COMPANY_WIDE_ROLES = new Set([
  "SUPER_ADMIN",
  "COMPANY_OWNER",
  "COMPANY_ADMIN",
]);

export function isCompanyWideProjectRole(roleKey: unknown) {
  return COMPANY_WIDE_ROLES.has(String(roleKey ?? "").toUpperCase());
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
