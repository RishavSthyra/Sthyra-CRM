import { isUuid } from "@/lib/permissions";
import { isObject } from "@/utils/isObject";
import { validatePassword } from "@/utils/validatePassword";
import { validateText } from "@/utils/validateText";
import { getDatabaseErrorCode } from "@/utils/getDatabaseErrorCode";

export const USER_COLUMNS = `
  user_id,
  team_id,
  role_id,
  username,
  first_name,
  last_name,
  email,
  phone,
  is_active,
  last_login,
  created_at,
  updated_at,
  created_by
`;

const USER_INPUT_FIELDS = [
  "team_id",
  "role_id",
  "username",
  "first_name",
  "last_name",
  "email",
  "phone",
  "password",
  "is_active",
] as const;

export type UserField = Exclude<(typeof USER_INPUT_FIELDS)[number], "password">;

export type UserWrite = Partial<{
  team_id: string | null;
  role_id: string;
  username: string;
  first_name: string;
  last_name: string | null;
  email: string;
  phone: string | null;
  password: string;
  is_active: boolean;
}>;

type ValidationResult =
  | { ok: true; data: UserWrite }
  | { ok: false; errors: string[] };

function validateUuid(
  value: unknown,
  field: string,
  nullable: boolean,
  errors: string[],
): string | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    if (nullable) {
      return null;
    }
    errors.push(`${field} cannot be null`);
    return undefined;
  }
  if (!isUuid(value)) {
    errors.push(`${field} must be a valid UUID`);
    return undefined;
  }
  return value.toLowerCase();
}

export function validateUserPayload(
  body: unknown,
  options: { partial: boolean },
): ValidationResult {
  if (!isObject(body) || Array.isArray(body)) {
    return { ok: false, errors: ["Request body must be a JSON object"] };
  }

  const allowedFields = new Set<string>(USER_INPUT_FIELDS);
  const errors = Object.keys(body)
    .filter((field) => !allowedFields.has(field))
    .map((field) => `Unknown field: ${field}`);
  const data: UserWrite = {};

  const teamId = validateUuid(body.team_id, "team_id", true, errors);
  if (teamId !== undefined) {
    data.team_id = teamId;
  }

  const roleId = validateUuid(body.role_id, "role_id", false, errors);
  if (typeof roleId === "string") {
    data.role_id = roleId;
  }

  const username = validateText(body.username, "username", 200, false, errors);
  if (typeof username === "string") {
    data.username = username;
  }

  const firstName = validateText(
    body.first_name,
    "first_name",
    200,
    false,
    errors,
  );
  if (typeof firstName === "string") {
    data.first_name = firstName;
  }

  const lastName = validateText(body.last_name, "last_name", 200, true, errors);
  if (lastName !== undefined) {
    data.last_name = lastName;
  }

  const email = validateText(body.email, "email", 255, false, errors);
  if (typeof email === "string") {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      errors.push("email must be a valid email address");
    } else {
      data.email = email.toLowerCase();
    }
  }

  const phone = validateText(body.phone, "phone", 20, true, errors);
  if (phone !== undefined) {
    data.phone = phone;
  }

  if (!options.partial && body.password !== undefined) {
    const passwordErrors = validatePassword(body.password);
    errors.push(...passwordErrors);
    if (passwordErrors.length === 0 && typeof body.password === "string") {
      data.password = body.password;
    }
  } else if (options.partial && body.password !== undefined) {
    errors.push(
      "password can only be changed through the auth password endpoints",
    );
  }

  if (body.is_active !== undefined) {
    if (typeof body.is_active !== "boolean") {
      errors.push("is_active must be a boolean");
    } else {
      data.is_active = body.is_active;
    }
  }

  if (!options.partial) {
    if (body.role_id === undefined) {
      errors.push("role_id is required");
    }
    if (body.username === undefined) {
      errors.push("username is required");
    }
    if (body.first_name === undefined) {
      errors.push("first_name is required");
    }
    if (body.email === undefined) {
      errors.push("email is required");
    }
    if (body.password === undefined) {
      errors.push("password is required");
    }
    if (body.is_active === undefined) {
      data.is_active = true;
    }
  } else if (Object.keys(body).length === 0) {
    errors.push("At least one field is required");
  }

  return errors.length > 0 ? { ok: false, errors } : { ok: true, data };
}

export function parseUserId(value: string): string | null {
  return isUuid(value) ? value : null;
}

export function getUserDatabaseErrorCode(error: unknown): string | null {
  return getDatabaseErrorCode(error);
}
