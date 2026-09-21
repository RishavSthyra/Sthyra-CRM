import { isUuid } from "@/lib/permissions";
import { isObject } from "@/utils/isObject";
import { validateText } from "@/utils/validateText";

type Result<T> = { ok: true; data: T } | { ok: false; errors: string[] };

export type LeadConfigurationWrite = Partial<{
  default_source_id: string | null;
  default_campaign_id: string | null;
  auto_assignment_enabled: boolean;
  assignment_strategy: "manual" | "round_robin" | "load_balanced";
  duplicate_check_enabled: boolean;
  duplicate_window_days: number;
  response_sla_minutes: number;
}>;

export function validateLeadConfiguration(
  body: unknown,
): Result<LeadConfigurationWrite> {
  if (!isObject(body) || Array.isArray(body)) {
    return { ok: false, errors: ["Request body must be a JSON object"] };
  }
  const fields = [
    "default_source_id",
    "default_campaign_id",
    "auto_assignment_enabled",
    "assignment_strategy",
    "duplicate_check_enabled",
    "duplicate_window_days",
    "response_sla_minutes",
  ];
  const allowed = new Set(fields);
  const errors = Object.keys(body)
    .filter((key) => !allowed.has(key))
    .map((key) => `Unknown field: ${key}`);
  const data: LeadConfigurationWrite = {};
  for (const field of ["default_source_id", "default_campaign_id"] as const) {
    const value = body[field];
    if (value === null) {
      data[field] = null;
    } else if (value !== undefined) {
      if (!isUuid(value)) {
        errors.push(`${field} must be a valid UUID or null`);
      } else {
        data[field] = value.toLowerCase();
      }
    }
  }
  for (const field of [
    "auto_assignment_enabled",
    "duplicate_check_enabled",
  ] as const) {
    if (body[field] !== undefined) {
      if (typeof body[field] !== "boolean") {
        errors.push(`${field} must be a boolean`);
      } else {
        data[field] = body[field];
      }
    }
  }
  if (body.assignment_strategy !== undefined) {
    const strategies = ["manual", "round_robin", "load_balanced"] as const;
    if (
      !strategies.includes(
        body.assignment_strategy as (typeof strategies)[number],
      )
    ) {
      errors.push(
        `assignment_strategy must be one of: ${strategies.join(", ")}`,
      );
    } else {
      data.assignment_strategy =
        body.assignment_strategy as LeadConfigurationWrite["assignment_strategy"];
    }
  }
  for (const [field, max] of [
    ["duplicate_window_days", 3650],
    ["response_sla_minutes", 43200],
  ] as const) {
    const value = body[field];
    if (value !== undefined) {
      if (
        !Number.isSafeInteger(value) ||
        (value as number) < 1 ||
        (value as number) > max
      ) {
        errors.push(`${field} must be an integer between 1 and ${max}`);
      } else {
        data[field] = value as number;
      }
    }
  }
  if (Object.keys(body).length === 0) {
    errors.push("At least one field is required");
  }
  return errors.length ? { ok: false, errors } : { ok: true, data };
}

function parseDefinitionArray(
  body: unknown,
  property: string,
): { items: unknown[]; errors: string[] } | null {
  if (!isObject(body) || Array.isArray(body)) {
    return null;
  }
  const errors = Object.keys(body)
    .filter((key) => key !== property)
    .map((key) => `Unknown field: ${key}`);
  const value = body[property];
  if (!Array.isArray(value)) {
    errors.push(`${property} must be an array`);
  }
  return { items: Array.isArray(value) ? value : [], errors };
}

export type StageInput = {
  stage_key: string;
  stage_name: string;
  position: number;
  is_initial: boolean;
  is_terminal: boolean;
};

export function validateStages(body: unknown): Result<StageInput[]> {
  const parsed = parseDefinitionArray(body, "stages");
  if (!parsed) {
    return { ok: false, errors: ["Request body must be a JSON object"] };
  }
  const stages: StageInput[] = [];
  const keys = new Set<string>();
  parsed.items.forEach((item, index) => {
    if (!isObject(item) || Array.isArray(item)) {
      parsed.errors.push(`stages[${index}] must be an object`);
      return;
    }
    const errors = parsed.errors;
    const unknown = Object.keys(item).filter(
      (key) =>
        !["stage_key", "stage_name", "is_initial", "is_terminal"].includes(key),
    );
    unknown.forEach((key) =>
      errors.push(`Unknown field in stages[${index}]: ${key}`),
    );
    const key = validateText(
      item.stage_key,
      `stages[${index}].stage_key`,
      50,
      false,
      errors,
    );
    const name = validateText(
      item.stage_name,
      `stages[${index}].stage_name`,
      100,
      false,
      errors,
    );
    if (item.stage_key === undefined) {
      errors.push(`stages[${index}].stage_key is required`);
    }
    if (item.stage_name === undefined) {
      errors.push(`stages[${index}].stage_name is required`);
    }
    for (const field of ["is_initial", "is_terminal"] as const) {
      if (item[field] !== undefined && typeof item[field] !== "boolean") {
        errors.push(`stages[${index}].${field} must be a boolean`);
      }
    }
    if (typeof key === "string" && typeof name === "string") {
      const normalizedKey = key.toLowerCase();
      if (keys.has(normalizedKey)) {
        errors.push(`Duplicate stage_key: ${normalizedKey}`);
      }
      keys.add(normalizedKey);
      stages.push({
        stage_key: normalizedKey,
        stage_name: name,
        position: index + 1,
        is_initial: item.is_initial === true,
        is_terminal: item.is_terminal === true,
      });
    }
  });
  if (stages.length === 0) {
    parsed.errors.push("At least one stage is required");
  }
  if (stages.filter((stage) => stage.is_initial).length !== 1) {
    parsed.errors.push("Exactly one stage must have is_initial=true");
  }
  return parsed.errors.length
    ? { ok: false, errors: parsed.errors }
    : { ok: true, data: stages };
}

export type QualificationFieldInput = {
  field_key: string;
  field_label: string;
  field_type: string;
  is_required: boolean;
  options: string[];
  position: number;
};

export function validateQualificationFields(
  body: unknown,
): Result<QualificationFieldInput[]> {
  const parsed = parseDefinitionArray(body, "fields");
  if (!parsed) {
    return { ok: false, errors: ["Request body must be a JSON object"] };
  }
  const output: QualificationFieldInput[] = [];
  const keys = new Set<string>();
  const types = [
    "text",
    "number",
    "boolean",
    "date",
    "single_select",
    "multi_select",
  ];
  parsed.items.forEach((item, index) => {
    if (!isObject(item) || Array.isArray(item)) {
      parsed.errors.push(`fields[${index}] must be an object`);
      return;
    }
    Object.keys(item)
      .filter(
        (key) =>
          ![
            "field_key",
            "field_label",
            "field_type",
            "is_required",
            "options",
          ].includes(key),
      )
      .forEach((key) =>
        parsed.errors.push(`Unknown field in fields[${index}]: ${key}`),
      );
    const key = validateText(
      item.field_key,
      `fields[${index}].field_key`,
      50,
      false,
      parsed.errors,
    );
    const label = validateText(
      item.field_label,
      `fields[${index}].field_label`,
      100,
      false,
      parsed.errors,
    );
    if (item.field_key === undefined) {
      parsed.errors.push(`fields[${index}].field_key is required`);
    }
    if (item.field_label === undefined) {
      parsed.errors.push(`fields[${index}].field_label is required`);
    }
    if (
      typeof item.field_type !== "string" ||
      !types.includes(item.field_type)
    ) {
      parsed.errors.push(
        `fields[${index}].field_type must be one of: ${types.join(", ")}`,
      );
    }
    if (
      item.is_required !== undefined &&
      typeof item.is_required !== "boolean"
    ) {
      parsed.errors.push(`fields[${index}].is_required must be a boolean`);
    }
    const options = item.options === undefined ? [] : item.options;
    if (
      !Array.isArray(options) ||
      options.some((option) => typeof option !== "string" || !option.trim())
    ) {
      parsed.errors.push(
        `fields[${index}].options must be an array of non-empty strings`,
      );
    }
    if (
      (item.field_type === "single_select" ||
        item.field_type === "multi_select") &&
      Array.isArray(options) &&
      options.length === 0
    ) {
      parsed.errors.push(
        `fields[${index}].options is required for select fields`,
      );
    }
    if (
      typeof key === "string" &&
      typeof label === "string" &&
      typeof item.field_type === "string" &&
      types.includes(item.field_type) &&
      Array.isArray(options)
    ) {
      const normalizedKey = key.toLowerCase();
      if (keys.has(normalizedKey)) {
        parsed.errors.push(`Duplicate field_key: ${normalizedKey}`);
      }
      keys.add(normalizedKey);
      output.push({
        field_key: normalizedKey,
        field_label: label,
        field_type: item.field_type,
        is_required: item.is_required === true,
        options: options as string[],
        position: index + 1,
      });
    }
  });
  return parsed.errors.length
    ? { ok: false, errors: parsed.errors }
    : { ok: true, data: output };
}

export type ClosingReasonInput = {
  reason_key: string;
  reason_name: string;
  outcome: string;
  position: number;
};

export function validateClosingReasons(
  body: unknown,
): Result<ClosingReasonInput[]> {
  const parsed = parseDefinitionArray(body, "reasons");
  if (!parsed) {
    return { ok: false, errors: ["Request body must be a JSON object"] };
  }
  const output: ClosingReasonInput[] = [];
  const keys = new Set<string>();
  const outcomes = ["won", "lost", "disqualified"];
  parsed.items.forEach((item, index) => {
    if (!isObject(item) || Array.isArray(item)) {
      parsed.errors.push(`reasons[${index}] must be an object`);
      return;
    }
    Object.keys(item)
      .filter((key) => !["reason_key", "reason_name", "outcome"].includes(key))
      .forEach((key) =>
        parsed.errors.push(`Unknown field in reasons[${index}]: ${key}`),
      );
    const key = validateText(
      item.reason_key,
      `reasons[${index}].reason_key`,
      50,
      false,
      parsed.errors,
    );
    const name = validateText(
      item.reason_name,
      `reasons[${index}].reason_name`,
      100,
      false,
      parsed.errors,
    );
    if (item.reason_key === undefined) {
      parsed.errors.push(`reasons[${index}].reason_key is required`);
    }
    if (item.reason_name === undefined) {
      parsed.errors.push(`reasons[${index}].reason_name is required`);
    }
    if (typeof item.outcome !== "string" || !outcomes.includes(item.outcome)) {
      parsed.errors.push(
        `reasons[${index}].outcome must be one of: ${outcomes.join(", ")}`,
      );
    }
    if (
      typeof key === "string" &&
      typeof name === "string" &&
      typeof item.outcome === "string" &&
      outcomes.includes(item.outcome)
    ) {
      const normalizedKey = key.toLowerCase();
      if (keys.has(normalizedKey)) {
        parsed.errors.push(`Duplicate reason_key: ${normalizedKey}`);
      }
      keys.add(normalizedKey);
      output.push({
        reason_key: normalizedKey,
        reason_name: name,
        outcome: item.outcome,
        position: index + 1,
      });
    }
  });
  return parsed.errors.length
    ? { ok: false, errors: parsed.errors }
    : { ok: true, data: output };
}
