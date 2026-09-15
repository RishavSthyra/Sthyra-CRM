import { isObject } from "@/utils/isObject";
import { isUuid } from "@/lib/permissions";
import { validateText } from "@/utils/validateText";

export const ROLE_COLUMNS = `
  role_id,
  role_key,
  role_name,
  description,
  is_active,
  is_system_role,
  created_at,
  updated_at
`;

const ROLE_FIELDS = ["role_key", "role_name", "description"] as const;

export type RoleField = (typeof ROLE_FIELDS)[number];

export type RoleWrite = Partial<{
  role_key: string;
  role_name: string;
  description: string | null;
}>;

type ValidationResult =
  | { ok: true; data: RoleWrite }
  | { ok: false; errors: string[] };

type RoleRow = Record<string, unknown>;

export function validateRolePayload(
  body: unknown,
  options: { partial: boolean },
): ValidationResult {
  if (!isObject(body) || Array.isArray(body)) {
    return { ok: false, errors: ["Request body must be a JSON object"] };
  }

  const allowedFields = new Set<string>(ROLE_FIELDS);
  const errors = Object.keys(body)
    .filter((field) => !allowedFields.has(field))
    .map((field) => `Unknown field: ${field}`);
  const data: RoleWrite = {};

  const roleKey = validateText(body.role_key, "role_key", 100, false, errors);
  if (typeof roleKey === "string") data.role_key = roleKey.toUpperCase();

  const roleName = validateText(body.role_name, "role_name", 150, false, errors);
  if (typeof roleName === "string") data.role_name = roleName;

  const description = validateText(
    body.description,
    "description",
    10000,
    true,
    errors,
  );
  if (description !== undefined) data.description = description;

  if (!options.partial) {
    if (body.role_key === undefined) errors.push("role_key is required");
    if (body.role_name === undefined) errors.push("role_name is required");
  } else if (Object.keys(body).length === 0) {
    errors.push("At least one field is required");
  }

  return errors.length > 0 ? { ok: false, errors } : { ok: true, data };
}

export function parseRoleId(value: string): string | null {
  return isUuid(value) ? value : null;
}

export function getRoleDatabaseErrorCode(error: unknown): string | null {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
  ) {
    return error.code;
  }

  return null;
}

export function serializeRole(row: RoleRow): RoleRow {
  return row;
}
