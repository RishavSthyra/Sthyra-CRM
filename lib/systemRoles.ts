export const SUPER_ADMIN_ROLE_KEY = "SUPER_ADMIN";

export const RETIRED_SYSTEM_ROLE_KEYS = [
  "COMPANY_OWNER",
  "COMPANY_ADMIN",
] as const;

export function isSuperAdminRole(roleKey: unknown): boolean {
  return String(roleKey ?? "").trim().toUpperCase() === SUPER_ADMIN_ROLE_KEY;
}

export function isRetiredSystemRole(roleKey: unknown): boolean {
  const normalized = String(roleKey ?? "").trim().toUpperCase();
  return RETIRED_SYSTEM_ROLE_KEYS.some((role) => role === normalized);
}
