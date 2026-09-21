import { isUuid } from "@/lib/permissions";
import { isObject } from "@/utils/isObject";
import { validateText } from "@/utils/validateText";

export const RELATIONSHIP_COLUMNS = `
  relationship_id,
  contact_id,
  related_contact_id,
  relationship_type,
  notes,
  created_at,
  updated_at
`;

const FIELDS = [
  "contact_id",
  "related_contact_id",
  "relationship_type",
  "notes",
] as const;

export type RelationshipField = (typeof FIELDS)[number];
export type RelationshipWrite = Partial<{
  contact_id: string;
  related_contact_id: string;
  relationship_type: string;
  notes: string | null;
}>;

type Result =
  | { ok: true; data: RelationshipWrite }
  | { ok: false; errors: string[] };

export function validateRelationshipPayload(
  body: unknown,
  options: { partial: boolean },
): Result {
  if (!isObject(body) || Array.isArray(body)) {
    return { ok: false, errors: ["Request body must be a JSON object"] };
  }
  const allowed = new Set<string>(FIELDS);
  const errors = Object.keys(body)
    .filter((field) => !allowed.has(field))
    .map((field) => `Unknown field: ${field}`);
  const data: RelationshipWrite = {};

  for (const field of ["contact_id", "related_contact_id"] as const) {
    const value = body[field];
    if (value !== undefined) {
      if (!isUuid(value)) {
        errors.push(`${field} must be a valid UUID`);
      } else {
        data[field] = value.toLowerCase();
      }
    }
  }
  const type = validateText(
    body.relationship_type,
    "relationship_type",
    50,
    false,
    errors,
  );
  if (typeof type === "string") {
    data.relationship_type = type.toLowerCase();
  }
  const notes = validateText(body.notes, "notes", 5000, true, errors);
  if (notes !== undefined) {
    data.notes = notes;
  }

  if (!options.partial) {
    for (const field of [
      "contact_id",
      "related_contact_id",
      "relationship_type",
    ] as const) {
      if (body[field] === undefined) {
        errors.push(`${field} is required`);
      }
    }
  } else if (Object.keys(body).length === 0) {
    errors.push("At least one field is required");
  }
  const contactId = data.contact_id ?? body.contact_id;
  const relatedId = data.related_contact_id ?? body.related_contact_id;
  if (typeof contactId === "string" && contactId === relatedId) {
    errors.push("A contact cannot be related to itself");
  }
  return errors.length ? { ok: false, errors } : { ok: true, data };
}

export function parseRelationshipId(value: string): string | null {
  return isUuid(value) ? value.toLowerCase() : null;
}
