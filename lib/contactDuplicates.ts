import { isUuid } from "@/lib/permissions";
import { isObject } from "@/utils/isObject";
import { validateText } from "@/utils/validateText";

type IdResult =
  | { ok: true; contactId: string }
  | { ok: false; errors: string[] };

function validateSingleContactId(body: unknown, field: string): IdResult {
  if (!isObject(body) || Array.isArray(body)) {
    return { ok: false, errors: ["Request body must be a JSON object"] };
  }
  const allowed = new Set([field]);
  const errors = Object.keys(body)
    .filter((key) => !allowed.has(key))
    .map((key) => `Unknown field: ${key}`);
  if (!isUuid(body[field])) {
    errors.push(`${field} must be a valid UUID`);
  }
  return errors.length
    ? { ok: false, errors }
    : { ok: true, contactId: (body[field] as string).toLowerCase() };
}

export function validateMergePayload(body: unknown): IdResult {
  return validateSingleContactId(body, "duplicate_contact_id");
}

export function validateUnmergePayload(
  body: unknown,
):
  | { ok: true; mergeId: string; notes: string | null }
  | { ok: false; errors: string[] } {
  if (!isObject(body) || Array.isArray(body)) {
    return { ok: false, errors: ["Request body must be a JSON object"] };
  }
  const errors = Object.keys(body)
    .filter((key) => !["merge_id", "notes"].includes(key))
    .map((key) => `Unknown field: ${key}`);
  if (!isUuid(body.merge_id)) {
    errors.push("merge_id must be a valid UUID");
  }
  const notes = validateText(body.notes, "notes", 5000, true, errors);
  return errors.length
    ? { ok: false, errors }
    : {
        ok: true,
        mergeId: (body.merge_id as string).toLowerCase(),
        notes: notes ?? null,
      };
}

export function validateNotDuplicatePayload(
  body: unknown,
):
  | { ok: true; candidateContactId: string; reason: string | null }
  | { ok: false; errors: string[] } {
  if (!isObject(body) || Array.isArray(body)) {
    return { ok: false, errors: ["Request body must be a JSON object"] };
  }
  const errors = Object.keys(body)
    .filter((key) => !["candidate_contact_id", "reason"].includes(key))
    .map((key) => `Unknown field: ${key}`);
  if (!isUuid(body.candidate_contact_id)) {
    errors.push("candidate_contact_id must be a valid UUID");
  }
  const reason = validateText(body.reason, "reason", 5000, true, errors);
  return errors.length
    ? { ok: false, errors }
    : {
        ok: true,
        candidateContactId: (body.candidate_contact_id as string).toLowerCase(),
        reason: reason ?? null,
      };
}
