import { isUuid } from "@/lib/permissions";
import { isObject } from "@/utils/isObject";

type SingleUuidResult =
  | { ok: true; value: string | null }
  | { ok: false; errors: string[] };

export function validateSingleUuidField(
  body: unknown,
  field: string,
  options: { nullable: boolean },
): SingleUuidResult {
  if (!isObject(body) || Array.isArray(body)) {
    return { ok: false, errors: ["Request body must be a JSON object"] };
  }

  const errors = Object.keys(body)
    .filter((key) => key !== field)
    .map((key) => `Unknown field: ${key}`);
  const value = body[field];

  if (value === undefined) {
    errors.push(`${field} is required`);
  } else if (value === null) {
    if (!options.nullable) errors.push(`${field} cannot be null`);
  } else if (!isUuid(value)) {
    errors.push(`${field} must be a valid UUID`);
  }

  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: typeof value === "string" ? value.toLowerCase() : null,
  };
}

type ProjectIdsResult =
  | { ok: true; projectIds: number[] }
  | { ok: false; errors: string[] };

export function validateProjectIds(body: unknown): ProjectIdsResult {
  if (!isObject(body) || Array.isArray(body)) {
    return { ok: false, errors: ["Request body must be a JSON object"] };
  }

  const errors = Object.keys(body)
    .filter((field) => field !== "project_ids")
    .map((field) => `Unknown field: ${field}`);
  const projectIds = body.project_ids;

  if (!Array.isArray(projectIds)) {
    errors.push("project_ids must be an array");
    return { ok: false, errors };
  }

  const normalizedIds: number[] = [];
  const seen = new Set<number>();
  projectIds.forEach((projectId, index) => {
    if (
      typeof projectId !== "number" ||
      !Number.isSafeInteger(projectId) ||
      projectId <= 0
    ) {
      errors.push(`project_ids[${index}] must be a positive integer`);
      return;
    }
    if (seen.has(projectId)) {
      errors.push(`project_ids contains a duplicate project ID: ${projectId}`);
      return;
    }
    seen.add(projectId);
    normalizedIds.push(projectId);
  });

  return errors.length > 0
    ? { ok: false, errors }
    : { ok: true, projectIds: normalizedIds };
}
