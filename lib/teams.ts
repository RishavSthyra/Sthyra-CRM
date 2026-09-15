import { isUuid } from "@/lib/permissions";
import { isObject } from "@/utils/isObject";
import { validateText } from "@/utils/validateText";

export const TEAM_COLUMNS = `
  team_id,
  company_id,
  name,
  team_type,
  description,
  is_active,
  created_at,
  updated_at
`;

const TEAM_FIELDS = ["company_id", "name", "team_type", "description"] as const;

export type TeamField = (typeof TEAM_FIELDS)[number];

export type TeamWrite = Partial<{
  company_id: number;
  name: string;
  team_type: string;
  description: string | null;
}>;

type ValidationResult =
  | { ok: true; data: TeamWrite }
  | { ok: false; errors: string[] };

type TeamRow = Record<string, unknown>;

export function validateTeamPayload(
  body: unknown,
  options: { partial: boolean },
): ValidationResult {
  if (!isObject(body) || Array.isArray(body)) {
    return { ok: false, errors: ["Request body must be a JSON object"] };
  }

  const allowedFields = new Set<string>(TEAM_FIELDS);
  const errors = Object.keys(body)
    .filter((field) => !allowedFields.has(field))
    .map((field) => `Unknown field: ${field}`);
  const data: TeamWrite = {};

  if (body.company_id !== undefined) {
    if (
      typeof body.company_id !== "number" ||
      !Number.isSafeInteger(body.company_id) ||
      body.company_id <= 0
    ) {
      errors.push("company_id must be a positive integer");
    } else {
      data.company_id = body.company_id;
    }
  }

  const name = validateText(body.name, "name", 150, false, errors);
  if (typeof name === "string") data.name = name;

  const teamType = validateText(body.team_type, "team_type", 50, false, errors);
  if (typeof teamType === "string") data.team_type = teamType;

  const description = validateText(
    body.description,
    "description",
    10000,
    true,
    errors,
  );
  if (description !== undefined) data.description = description;

  if (!options.partial) {
    if (body.company_id === undefined) errors.push("company_id is required");
    if (body.name === undefined) errors.push("name is required");
    if (body.team_type === undefined) errors.push("team_type is required");
  } else if (Object.keys(body).length === 0) {
    errors.push("At least one field is required");
  }

  return errors.length > 0 ? { ok: false, errors } : { ok: true, data };
}

export function parseTeamId(value: string): string | null {
  return isUuid(value) ? value : null;
}

export function getTeamDatabaseErrorCode(error: unknown): string | null {
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

export function serializeTeam(row: TeamRow): TeamRow {
  return row;
}
