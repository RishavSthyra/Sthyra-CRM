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
