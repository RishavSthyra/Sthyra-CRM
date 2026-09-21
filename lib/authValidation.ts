import { isObject } from "@/utils/isObject";
import { validatePassword } from "@/utils/validatePassword";
import { validateText } from "@/utils/validateText";

type ValidationResult<T> =
  | { ok: true; data: T }
  | { ok: false; errors: string[] };

function rejectUnknownFields(
  body: Record<string, unknown>,
  fields: readonly string[],
): string[] {
  const allowed = new Set(fields);
  return Object.keys(body)
    .filter((field) => !allowed.has(field))
    .map((field) => `Unknown field: ${field}`);
}

function objectBody(body: unknown): Record<string, unknown> | null {
  return isObject(body) && !Array.isArray(body) ? body : null;
}

function validateSecretString(
  value: unknown,
  field: string,
  maxLength: number,
  errors: string[],
): string | undefined {
  if (typeof value !== "string") {
    errors.push(`${field} must be a string`);
    return undefined;
  }
  if (value.length === 0) {
    errors.push(`${field} cannot be empty`);
    return undefined;
  }
  if (value.length > maxLength) {
    errors.push(`${field} cannot exceed ${maxLength} characters`);
    return undefined;
  }
  return value;
}

export function validateLoginPayload(
  body: unknown,
): ValidationResult<{ identifier: string; password: string }> {
  const value = objectBody(body);
  if (!value) {
    return { ok: false, errors: ["Request body must be a JSON object"] };
  }

  const errors = rejectUnknownFields(value, ["identifier", "password"]);
  const identifier = validateText(
    value.identifier,
    "identifier",
    255,
    false,
    errors,
  );
  const password = validateSecretString(
    value.password,
    "password",
    128,
    errors,
  );
  return errors.length ||
    typeof identifier !== "string" ||
    typeof password !== "string"
    ? { ok: false, errors }
    : { ok: true, data: { identifier, password } };
}

export function validateChangePasswordPayload(
  body: unknown,
): ValidationResult<{ currentPassword: string; newPassword: string }> {
  const value = objectBody(body);
  if (!value) {
    return { ok: false, errors: ["Request body must be a JSON object"] };
  }

  const errors = rejectUnknownFields(value, [
    "current_password",
    "new_password",
  ]);
  const currentPassword = validateSecretString(
    value.current_password,
    "current_password",
    128,
    errors,
  );
  errors.push(...validatePassword(value.new_password, "new_password"));
  if (value.new_password === value.current_password) {
    errors.push("new_password must be different from current_password");
  }
  return errors.length ||
    typeof currentPassword !== "string" ||
    typeof value.new_password !== "string"
    ? { ok: false, errors }
    : {
        ok: true,
        data: { currentPassword, newPassword: value.new_password },
      };
}

export function validateForgotPasswordPayload(
  body: unknown,
): ValidationResult<{ email: string }> {
  const value = objectBody(body);
  if (!value) {
    return { ok: false, errors: ["Request body must be a JSON object"] };
  }

  const errors = rejectUnknownFields(value, ["email"]);
  const email = validateText(value.email, "email", 255, false, errors);
  if (typeof email === "string" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errors.push("email must be a valid email address");
  }
  return errors.length || typeof email !== "string"
    ? { ok: false, errors }
    : { ok: true, data: { email: email.toLowerCase() } };
}

export function validateResetPasswordPayload(
  body: unknown,
): ValidationResult<{ token: string; newPassword: string }> {
  const value = objectBody(body);
  if (!value) {
    return { ok: false, errors: ["Request body must be a JSON object"] };
  }

  const errors = rejectUnknownFields(value, ["token", "new_password"]);
  const token = validateText(value.token, "token", 256, false, errors);
  errors.push(...validatePassword(value.new_password, "new_password"));
  return errors.length ||
    typeof token !== "string" ||
    typeof value.new_password !== "string"
    ? { ok: false, errors }
    : { ok: true, data: { token, newPassword: value.new_password } };
}

export type ProfileWrite = Partial<{
  username: string;
  first_name: string;
  last_name: string | null;
  email: string;
  phone: string | null;
}>;

export function validateProfilePayload(
  body: unknown,
): ValidationResult<ProfileWrite> {
  const value = objectBody(body);
  if (!value) {
    return { ok: false, errors: ["Request body must be a JSON object"] };
  }

  const fields = [
    "username",
    "first_name",
    "last_name",
    "email",
    "phone",
  ] as const;
  const errors = rejectUnknownFields(value, fields);
  const data: ProfileWrite = {};

  const username = validateText(value.username, "username", 200, false, errors);
  if (typeof username === "string") {
    data.username = username;
  }
  const firstName = validateText(
    value.first_name,
    "first_name",
    200,
    false,
    errors,
  );
  if (typeof firstName === "string") {
    data.first_name = firstName;
  }
  const lastName = validateText(
    value.last_name,
    "last_name",
    200,
    true,
    errors,
  );
  if (lastName !== undefined) {
    data.last_name = lastName;
  }
  const email = validateText(value.email, "email", 255, false, errors);
  if (typeof email === "string") {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      errors.push("email must be a valid email address");
    } else {
      data.email = email.toLowerCase();
    }
  }
  const phone = validateText(value.phone, "phone", 20, true, errors);
  if (phone !== undefined) {
    data.phone = phone;
  }

  if (Object.keys(value).length === 0) {
    errors.push("At least one field is required");
  }
  return errors.length ? { ok: false, errors } : { ok: true, data };
}
