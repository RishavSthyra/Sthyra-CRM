import { isObject } from "@/utils/isObject";
import { validateText } from "@/utils/validateText";

export const PERMISSION_COLUMNS = `
  permission_id,
  permission_key,
  permission_name,
  feature_key,
  action,
  description,
  created_at,
  updated_at
`;

const PERMISSION_FIELDS = [
  "permission_key",
  "permission_name",
  "feature_key",
  "action",
  "description",
] as const;

export type PermissionField = (typeof PERMISSION_FIELDS)[number];

export type PermissionWrite = Partial<{
  permission_key: string;
  permission_name: string;
  feature_key: string;
  action: string;
  description: string | null;
}>;

type ValidationResult =
  | { ok: true; data: PermissionWrite }
  | { ok: false; errors: string[] };

type PermissionRow = Record<string, unknown>;

export function validatePermissionPayload(
  body: unknown,
  options: { partial: boolean },
): ValidationResult {
  if (!isObject(body) || Array.isArray(body)) {
    return { ok: false, errors: ["Request body must be a JSON object"] };
  }

  const allowedFields = new Set<string>(PERMISSION_FIELDS);
  const errors = Object.keys(body)
    .filter((field) => !allowedFields.has(field))
    .map((field) => `Unknown field: ${field}`);
  const data: PermissionWrite = {};

  const permissionKey = validateText(
    body.permission_key,
    "permission_key",
    150,
    false,
    errors,
  );
  if (typeof permissionKey === "string") {
    data.permission_key = permissionKey.toUpperCase();
  }

  const permissionName = validateText(
    body.permission_name,
    "permission_name",
    150,
    false,
    errors,
  );
  if (typeof permissionName === "string") {
    data.permission_name = permissionName;
  }

  const featureKey = validateText(
    body.feature_key,
    "feature_key",
    100,
    false,
    errors,
  );
  if (typeof featureKey === "string") {
    data.feature_key = featureKey.toUpperCase();
  }

  const action = validateText(body.action, "action", 50, false, errors);
  if (typeof action === "string") data.action = action;

  const description = validateText(
    body.description,
    "description",
    10000,
    true,
    errors,
  );
  if (description !== undefined) data.description = description;

  if (!options.partial) {
    if (body.permission_key === undefined) {
      errors.push("permission_key is required");
    }
    if (body.permission_name === undefined) {
      errors.push("permission_name is required");
    }
    if (body.feature_key === undefined) {
      errors.push("feature_key is required");
    }
    if (body.action === undefined) errors.push("action is required");
  } else if (Object.keys(body).length === 0) {
    errors.push("At least one field is required");
  }

  return errors.length > 0 ? { ok: false, errors } : { ok: true, data };
}

// Keep the original export spelling available to existing callers.
export function ValidatePermissionPayload(
  body: unknown,
  options: { isPartial: boolean },
): ValidationResult {
  return validatePermissionPayload(body, { partial: options.isPartial });
}

export function parsePermissionId(value: string): string | null {
  return isUuid(value) ? value : null;
}

export function isUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  );
}

export function getPermissionDatabaseErrorCode(error: unknown): string | null {
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

export function serializePermission(row: PermissionRow): PermissionRow {
  return row;
}
