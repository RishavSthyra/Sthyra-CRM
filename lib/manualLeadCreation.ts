import type { PoolClient } from "pg";
import {
  createContact,
  type ContactWrite,
  validateContactPayload,
} from "@/lib/contacts";
import {
  type LeadWrite,
  validateLeadPayload,
} from "@/lib/leads";
import { isObject } from "@/utils/isObject";

const VALIDATION_CONTACT_ID = "00000000-0000-4000-8000-000000000000";
const STAGE_KEY_PATTERN = /^[a-z0-9]+(?:_[a-z0-9]+)*$/;

export type ManualLeadCreationPayload = {
  project_id: number;
  stage_key: string;
  contact: ContactWrite;
  lead: Omit<LeadWrite, "contact_id" | "project_id">;
};

type ManualLeadCreationValidation =
  | { ok: true; data: ManualLeadCreationPayload }
  | { ok: false; errors: string[] };

export function validateManualLeadCreationPayload(
  body: unknown,
): ManualLeadCreationValidation {
  if (!isObject(body) || Array.isArray(body)) {
    return { ok: false, errors: ["Request body must be a JSON object"] };
  }

  const allowed = new Set(["project_id", "stage_key", "contact", "lead"]);
  const errors = Object.keys(body)
    .filter((field) => !allowed.has(field))
    .map((field) => `Unknown field: ${field}`);

  const projectId = body.project_id;
  if (!Number.isSafeInteger(projectId) || Number(projectId) <= 0) {
    errors.push("project_id must be a positive integer");
  }

  const stageKey =
    typeof body.stage_key === "string"
      ? body.stage_key.trim().toLowerCase()
      : "";
  if (!stageKey) {
    errors.push("stage_key is required");
  } else if (!STAGE_KEY_PATTERN.test(stageKey) || stageKey.length > 100) {
    errors.push("stage_key must be a valid stage key");
  }

  const contactValidation = validateContactPayload(body.contact, {
    partial: false,
  });
  if (!contactValidation.ok) {
    errors.push(...contactValidation.errors.map((error) => `contact.${error}`));
  } else if (
    !contactValidation.data.phone_number &&
    !contactValidation.data.email
  ) {
    errors.push("contact.phone_number or contact.email is required");
  }

  if (!isObject(body.lead) || Array.isArray(body.lead)) {
    errors.push("lead must be a JSON object");
  }
  const leadBody = isObject(body.lead) && !Array.isArray(body.lead)
    ? body.lead
    : {};
  if ("contact_id" in leadBody || "project_id" in leadBody) {
    errors.push("contact_id and project_id must be provided at the top level");
  }
  const leadValidation = validateLeadPayload(
    {
      ...leadBody,
      contact_id: VALIDATION_CONTACT_ID,
      project_id: Number.isSafeInteger(projectId) ? projectId : 0,
    },
    { partial: false },
  );
  if (!leadValidation.ok) {
    errors.push(...leadValidation.errors.map((error) => `lead.${error}`));
  }

  if (
    errors.length ||
    !contactValidation.ok ||
    !leadValidation.ok ||
    !Number.isSafeInteger(projectId)
  ) {
    return { ok: false, errors: [...new Set(errors)] };
  }

  const lead = { ...leadValidation.data };
  delete lead.contact_id;
  delete lead.project_id;
  return {
    ok: true,
    data: {
      project_id: Number(projectId),
      stage_key: stageKey,
      contact: contactValidation.data,
      lead,
    },
  };
}

export function getManualContactIdentityKey(
  companyId: number,
  contact: Pick<ContactWrite, "email" | "phone_number">,
) {
  const email = contact.email?.trim().toLowerCase() ?? "";
  const phone = contact.phone_number?.replace(/\D/g, "") ?? "";
  return `${companyId}|${email}|${phone}`;
}

export async function resolveOrCreateManualContact(
  client: PoolClient,
  contact: ContactWrite,
  companyId: number,
) {
  const identityKey = getManualContactIdentityKey(companyId, contact);
  await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
    identityKey,
  ]);

  const existing = await client.query(
    `SELECT contact_id
     FROM contacts
     WHERE company_id=$3
       AND archived_at IS NULL
       AND merged_into_contact_id IS NULL
       AND (
         ($1::text IS NOT NULL AND LOWER(email)=LOWER($1))
         OR ($2::text IS NOT NULL AND REGEXP_REPLACE(phone_number, '\\D', '', 'g')=REGEXP_REPLACE($2, '\\D', '', 'g'))
       )
     ORDER BY created_at ASC
     LIMIT 1`,
    [contact.email ?? null, contact.phone_number ?? null, companyId],
  );
  if (existing.rowCount) {
    return { contactId: String(existing.rows[0].contact_id), created: false };
  }

  const created = await createContact(client, contact, companyId);
  return { contactId: String(created.contact_id), created: true };
}
