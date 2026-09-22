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

const SIGNUP_JOB_ROLES = [
  "founder",
  "sales_manager",
  "sales_executive",
  "operations",
] as const;

export type SignupPayload = {
  first_name: string;
  last_name: string | null;
  email: string;
  password: string;
  company_name: string;
  company_legal_name: string | null;
  company_code: string;
  company_phone_number: string;
  company_contact_email: string;
  established_on: string;
  job_role: (typeof SIGNUP_JOB_ROLES)[number];
};

export function validateSignupPayload(
  body: unknown,
): ValidationResult<SignupPayload> {
  const value = objectBody(body);
  if (!value) {
    return { ok: false, errors: ["Request body must be a JSON object"] };
  }

  const fields = [
    "first_name",
    "last_name",
    "email",
    "password",
    "company_name",
    "company_legal_name",
    "company_code",
    "company_phone_number",
    "company_contact_email",
    "established_on",
    "job_role",
  ] as const;
  const errors = rejectUnknownFields(value, fields);
  const firstName = validateText(
    value.first_name,
    "first_name",
    200,
    false,
    errors,
  );
  const lastName = validateText(
    value.last_name,
    "last_name",
    200,
    true,
    errors,
  );
  const email = validateText(value.email, "email", 255, false, errors);
  const companyName = validateText(
    value.company_name,
    "company_name",
    200,
    false,
    errors,
  );
  const companyLegalName = validateText(
    value.company_legal_name,
    "company_legal_name",
    200,
    true,
    errors,
  );
  const companyCode = validateText(
    value.company_code,
    "company_code",
    50,
    false,
    errors,
  );
  const companyPhone = validateText(
    value.company_phone_number,
    "company_phone_number",
    20,
    false,
    errors,
  );
  const companyEmail = validateText(
    value.company_contact_email,
    "company_contact_email",
    255,
    false,
    errors,
  );
  errors.push(...validatePassword(value.password));

  if (typeof email === "string" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errors.push("email must be a valid email address");
  }
  if (
    typeof companyEmail === "string" &&
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(companyEmail)
  ) {
    errors.push("company_contact_email must be a valid email address");
  }
  if (
    typeof companyPhone === "string" &&
    !/^\+?[0-9]{10,19}$/.test(companyPhone)
  ) {
    errors.push("company_phone_number must contain 10 to 19 digits");
  }
  if (
    typeof companyCode === "string" &&
    !/^[A-Za-z0-9][A-Za-z0-9_-]{1,49}$/.test(companyCode)
  ) {
    errors.push(
      "company_code must contain 2 to 50 letters, numbers, underscores, or hyphens",
    );
  }

  const establishedOn = value.established_on;
  if (
    typeof establishedOn !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(establishedOn) ||
    Number.isNaN(Date.parse(`${establishedOn}T00:00:00Z`))
  ) {
    errors.push("established_on must be a valid date in YYYY-MM-DD format");
  } else if (establishedOn > new Date().toISOString().slice(0, 10)) {
    errors.push("established_on cannot be in the future");
  }

  const jobRole = value.job_role;
  if (
    typeof jobRole !== "string" ||
    !SIGNUP_JOB_ROLES.includes(jobRole as SignupPayload["job_role"])
  ) {
    errors.push(
      "job_role must be founder, sales_manager, sales_executive, or operations",
    );
  }

  const required = [
    "first_name",
    "email",
    "password",
    "company_name",
    "company_code",
    "company_phone_number",
    "company_contact_email",
    "established_on",
    "job_role",
  ] as const;
  for (const field of required) {
    if (value[field] === undefined) {
      errors.push(`${field} is required`);
    }
  }

  if (
    errors.length ||
    typeof firstName !== "string" ||
    typeof email !== "string" ||
    typeof value.password !== "string" ||
    typeof companyName !== "string" ||
    typeof companyCode !== "string" ||
    typeof companyPhone !== "string" ||
    typeof companyEmail !== "string" ||
    typeof establishedOn !== "string" ||
    typeof jobRole !== "string"
  ) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    data: {
      first_name: firstName,
      last_name: lastName ?? null,
      email: email.toLowerCase(),
      password: value.password,
      company_name: companyName,
      company_legal_name: companyLegalName ?? null,
      company_code: companyCode.toUpperCase(),
      company_phone_number: companyPhone,
      company_contact_email: companyEmail.toLowerCase(),
      established_on: establishedOn,
      job_role: jobRole as SignupPayload["job_role"],
    },
  };
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
