import { isUuid } from "@/lib/permissions";
import { isObject } from "@/utils/isObject";
import { validateText } from "@/utils/validateText";

export const ACCOUNT_COLUMNS = `
  account_id,
  name,
  account_type,
  archived_at,
  created_at,
  updated_at
`;

const ACCOUNT_FIELDS = ["name", "account_type"] as const;

export type AccountField = (typeof ACCOUNT_FIELDS)[number];
export type AccountWrite = Partial<Record<AccountField, string>>;

type ValidationResult =
  | { ok: true; data: AccountWrite }
  | { ok: false; errors: string[] };

export function validateAccountPayload(
  body: unknown,
  options: { partial: boolean },
): ValidationResult {
  if (!isObject(body) || Array.isArray(body)) {
    return { ok: false, errors: ["Request body must be a JSON object"] };
  }

  const allowed = new Set<string>(ACCOUNT_FIELDS);
  const errors = Object.keys(body)
    .filter((field) => !allowed.has(field))
    .map((field) => `Unknown field: ${field}`);
  const data: AccountWrite = {};

  const name = validateText(body.name, "name", 200, false, errors);
  if (typeof name === "string") {
    data.name = name;
  }
  const accountType = validateText(
    body.account_type,
    "account_type",
    50,
    false,
    errors,
  );
  if (typeof accountType === "string") {
    data.account_type = accountType.toLowerCase();
  }

  if (!options.partial) {
    if (body.name === undefined) {
      errors.push("name is required");
    }
    if (body.account_type === undefined) {
      errors.push("account_type is required");
    }
  } else if (Object.keys(body).length === 0) {
    errors.push("At least one field is required");
  }

  return errors.length ? { ok: false, errors } : { ok: true, data };
}

export function parseAccountId(value: string): string | null {
  return isUuid(value) ? value.toLowerCase() : null;
}
