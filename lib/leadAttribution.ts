import { isUuid } from "@/lib/permissions";
import { isObject } from "@/utils/isObject";
import { validateDate } from "@/utils/validateDate";
import { validateText } from "@/utils/validateText";

export const LEAD_SOURCE_COLUMNS = `
  source_id, source_name, source_type, code, is_active, created_at, updated_at
`;
export const CAMPAIGN_COLUMNS = `
  campaign_id, source_id, campaign_name, campaign_code, campaign_type,
  start_date::text AS start_date, end_date::text AS end_date, budget,
  is_active, created_at, updated_at
`;
export const TAG_COLUMNS = `
  tag_id, tag_name, description, color, archived_at, created_at, updated_at
`;

type ValidationResult<T> =
  | { ok: true; data: T }
  | { ok: false; errors: string[] };

function base(
  body: unknown,
  fields: readonly string[],
): { body: Record<string, unknown>; errors: string[] } | null {
  if (!isObject(body) || Array.isArray(body)) {
    return null;
  }
  const allowed = new Set(fields);
  return {
    body,
    errors: Object.keys(body)
      .filter((field) => !allowed.has(field))
      .map((field) => `Unknown field: ${field}`),
  };
}

export type LeadSourceWrite = Partial<{
  source_name: string;
  source_type: string;
  code: string;
}>;

export function validateLeadSourcePayload(
  body: unknown,
  partial: boolean,
): ValidationResult<LeadSourceWrite> {
  const parsed = base(body, ["source_name", "source_type", "code"]);
  if (!parsed) {
    return { ok: false, errors: ["Request body must be a JSON object"] };
  }
  const { errors } = parsed;
  const data: LeadSourceWrite = {};
  const name = validateText(
    parsed.body.source_name,
    "source_name",
    150,
    false,
    errors,
  );
  if (typeof name === "string") {
    data.source_name = name;
  }
  const type = validateText(
    parsed.body.source_type,
    "source_type",
    50,
    false,
    errors,
  );
  if (typeof type === "string") {
    data.source_type = type.toLowerCase();
  }
  const code = validateText(parsed.body.code, "code", 50, false, errors);
  if (typeof code === "string") {
    data.code = code.toUpperCase();
  }
  if (!partial) {
    for (const field of ["source_name", "source_type", "code"] as const) {
      if (parsed.body[field] === undefined) {
        errors.push(`${field} is required`);
      }
    }
  } else if (Object.keys(parsed.body).length === 0) {
    errors.push("At least one field is required");
  }
  return errors.length ? { ok: false, errors } : { ok: true, data };
}

export type CampaignWrite = Partial<{
  source_id: string | null;
  campaign_name: string;
  campaign_code: string;
  campaign_type: string | null;
  start_date: string | null;
  end_date: string | null;
  budget: number | null;
}>;

export function validateCampaignPayload(
  body: unknown,
  partial: boolean,
): ValidationResult<CampaignWrite> {
  const fields = [
    "source_id",
    "campaign_name",
    "campaign_code",
    "campaign_type",
    "start_date",
    "end_date",
    "budget",
  ];
  const parsed = base(body, fields);
  if (!parsed) {
    return { ok: false, errors: ["Request body must be a JSON object"] };
  }
  const { errors } = parsed;
  const value = parsed.body;
  const data: CampaignWrite = {};
  if (value.source_id !== undefined) {
    if (value.source_id === null) {
      data.source_id = null;
    } else if (!isUuid(value.source_id)) {
      errors.push("source_id must be a valid UUID or null");
    } else {
      data.source_id = value.source_id.toLowerCase();
    }
  }
  const name = validateText(
    value.campaign_name,
    "campaign_name",
    200,
    false,
    errors,
  );
  if (typeof name === "string") {
    data.campaign_name = name;
  }
  const code = validateText(
    value.campaign_code,
    "campaign_code",
    50,
    false,
    errors,
  );
  if (typeof code === "string") {
    data.campaign_code = code.toUpperCase();
  }
  const type = validateText(
    value.campaign_type,
    "campaign_type",
    50,
    true,
    errors,
  );
  if (type !== undefined) {
    data.campaign_type = type;
  }
  const start = validateDate(value.start_date, "start_date", errors);
  if (start !== undefined) {
    data.start_date = start;
  }
  const end = validateDate(value.end_date, "end_date", errors);
  if (end !== undefined) {
    data.end_date = end;
  }
  if (typeof start === "string" && typeof end === "string" && end < start) {
    errors.push("end_date cannot be earlier than start_date");
  }
  if (value.budget !== undefined) {
    if (value.budget === null) {
      data.budget = null;
    } else if (
      typeof value.budget !== "number" ||
      !Number.isFinite(value.budget) ||
      value.budget < 0
    ) {
      errors.push("budget must be a non-negative finite number or null");
    } else {
      data.budget = value.budget;
    }
  }
  if (!partial) {
    if (value.campaign_name === undefined) {
      errors.push("campaign_name is required");
    }
    if (value.campaign_code === undefined) {
      errors.push("campaign_code is required");
    }
  } else if (Object.keys(value).length === 0) {
    errors.push("At least one field is required");
  }
  return errors.length ? { ok: false, errors } : { ok: true, data };
}

export type TagWrite = Partial<{
  tag_name: string;
  description: string | null;
  color: string | null;
}>;

export function validateTagPayload(
  body: unknown,
  partial: boolean,
): ValidationResult<TagWrite> {
  const parsed = base(body, ["tag_name", "description", "color"]);
  if (!parsed) {
    return { ok: false, errors: ["Request body must be a JSON object"] };
  }
  const { errors } = parsed;
  const data: TagWrite = {};
  const name = validateText(
    parsed.body.tag_name,
    "tag_name",
    100,
    false,
    errors,
  );
  if (typeof name === "string") {
    data.tag_name = name;
  }
  const description = validateText(
    parsed.body.description,
    "description",
    5000,
    true,
    errors,
  );
  if (description !== undefined) {
    data.description = description;
  }
  const color = validateText(parsed.body.color, "color", 20, true, errors);
  if (typeof color === "string" && !/^#[0-9A-Fa-f]{6}$/.test(color)) {
    errors.push("color must be a six-digit hex color such as #1A2B3C");
  } else if (color !== undefined) {
    data.color = color;
  }
  if (!partial && parsed.body.tag_name === undefined) {
    errors.push("tag_name is required");
  } else if (partial && Object.keys(parsed.body).length === 0) {
    errors.push("At least one field is required");
  }
  return errors.length ? { ok: false, errors } : { ok: true, data };
}

export function parseUuidId(value: string): string | null {
  return isUuid(value) ? value.toLowerCase() : null;
}
