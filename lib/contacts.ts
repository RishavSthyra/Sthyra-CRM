import type { PoolClient, QueryResult } from "pg";
import { isUuid } from "@/lib/permissions";
import { isObject } from "@/utils/isObject";
import { validateDate } from "@/utils/validateDate";
import { validateText } from "@/utils/validateText";

export const CONTACT_COLUMNS = `
  contact_id,
  account_id,
  first_name,
  last_name,
  phone_number,
  alternate_phone_number,
  email,
  date_of_birth::text AS date_of_birth,
  is_nri,
  country,
  company_works_at,
  is_married,
  anniversary_date::text AS anniversary_date,
  address,
  merged_into_contact_id,
  archived_at,
  created_at,
  updated_at
`;

const CONTACT_FIELDS = [
  "account_id",
  "first_name",
  "last_name",
  "phone_number",
  "alternate_phone_number",
  "email",
  "date_of_birth",
  "is_nri",
  "country",
  "company_works_at",
  "is_married",
  "anniversary_date",
  "address",
] as const;

export type ContactField = (typeof CONTACT_FIELDS)[number];
export type ContactWrite = Partial<{
  account_id: string | null;
  first_name: string;
  last_name: string | null;
  phone_number: string | null;
  alternate_phone_number: string | null;
  email: string | null;
  date_of_birth: string | null;
  is_nri: boolean;
  country: string | null;
  company_works_at: string | null;
  is_married: boolean;
  anniversary_date: string | null;
  address: string | null;
}>;

type ValidationResult =
  | { ok: true; data: ContactWrite }
  | { ok: false; errors: string[] };

function validateUuid(
  value: unknown,
  errors: string[],
): string | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  if (!isUuid(value)) {
    errors.push("account_id must be a valid UUID or null");
    return undefined;
  }
  return value.toLowerCase();
}

function validatePhone(
  value: unknown,
  field: string,
  errors: string[],
): string | null | undefined {
  const phone = validateText(value, field, 20, true, errors);
  if (typeof phone === "string" && !/^\+?[0-9][0-9 ()-]{6,19}$/.test(phone)) {
    errors.push(`${field} must be a valid phone number`);
    return undefined;
  }
  return phone;
}

function validateBoolean(
  value: unknown,
  field: string,
  errors: string[],
): boolean | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "boolean") {
    errors.push(`${field} must be a boolean`);
    return undefined;
  }
  return value;
}

export function validateContactPayload(
  body: unknown,
  options: { partial: boolean },
): ValidationResult {
  if (!isObject(body) || Array.isArray(body)) {
    return { ok: false, errors: ["Request body must be a JSON object"] };
  }

  const allowed = new Set<string>(CONTACT_FIELDS);
  const errors = Object.keys(body)
    .filter((field) => !allowed.has(field))
    .map((field) => `Unknown field: ${field}`);
  const data: ContactWrite = {};

  const accountId = validateUuid(body.account_id, errors);
  if (accountId !== undefined) {
    data.account_id = accountId;
  }
  const firstName = validateText(
    body.first_name,
    "first_name",
    200,
    false,
    errors,
  );
  if (typeof firstName === "string") {
    data.first_name = firstName;
  }
  const lastName = validateText(body.last_name, "last_name", 200, true, errors);
  if (lastName !== undefined) {
    data.last_name = lastName;
  }
  const phone = validatePhone(body.phone_number, "phone_number", errors);
  if (phone !== undefined) {
    data.phone_number = phone;
  }
  const alternatePhone = validatePhone(
    body.alternate_phone_number,
    "alternate_phone_number",
    errors,
  );
  if (alternatePhone !== undefined) {
    data.alternate_phone_number = alternatePhone;
  }
  const email = validateText(body.email, "email", 255, true, errors);
  if (typeof email === "string") {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      errors.push("email must be a valid email address");
    } else {
      data.email = email.toLowerCase();
    }
  } else if (email === null) {
    data.email = null;
  }

  const dateOfBirth = validateDate(body.date_of_birth, "date_of_birth", errors);
  if (dateOfBirth !== undefined) {
    if (
      typeof dateOfBirth === "string" &&
      dateOfBirth > new Date().toISOString().slice(0, 10)
    ) {
      errors.push("date_of_birth cannot be in the future");
    } else {
      data.date_of_birth = dateOfBirth;
    }
  }
  const isNri = validateBoolean(body.is_nri, "is_nri", errors);
  if (isNri !== undefined) {
    data.is_nri = isNri;
  }
  const country = validateText(body.country, "country", 100, true, errors);
  if (country !== undefined) {
    data.country = country;
  }
  const company = validateText(
    body.company_works_at,
    "company_works_at",
    200,
    true,
    errors,
  );
  if (company !== undefined) {
    data.company_works_at = company;
  }
  const isMarried = validateBoolean(body.is_married, "is_married", errors);
  if (isMarried !== undefined) {
    data.is_married = isMarried;
  }
  const anniversary = validateDate(
    body.anniversary_date,
    "anniversary_date",
    errors,
  );
  if (anniversary !== undefined) {
    data.anniversary_date = anniversary;
  }
  const address = validateText(body.address, "address", 5000, true, errors);
  if (address !== undefined) {
    data.address = address;
  }

  if (!options.partial) {
    if (body.first_name === undefined) {
      errors.push("first_name is required");
    }
    if (body.phone_number === undefined && body.email === undefined) {
      errors.push("phone_number or email is required");
    }
    if (body.is_nri === undefined) {
      data.is_nri = false;
    }
    if (body.is_married === undefined) {
      data.is_married = false;
    }
  } else if (Object.keys(body).length === 0) {
    errors.push("At least one field is required");
  }

  return errors.length ? { ok: false, errors } : { ok: true, data };
}

export function parseContactId(value: string): string | null {
  return isUuid(value) ? value.toLowerCase() : null;
}

export async function addTimelineEvent(
  client: PoolClient,
  contactId: string,
  eventType: string,
  title: string,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  await client.query(
    `INSERT INTO contact_timeline_events (
       contact_id,
       event_type,
       title,
       metadata
     )
     VALUES ($1, $2, $3, $4::jsonb)`,
    [contactId, eventType, title, JSON.stringify(metadata)],
  );
}

type ContactRow = Record<string, unknown> & { contact_id: string };

export async function createContact(
  client: PoolClient,
  contact: ContactWrite,
): Promise<ContactRow> {
  const result = await client.query(
    `INSERT INTO contacts (
       account_id,
       first_name,
       last_name,
       phone_number,
       alternate_phone_number,
       email,
       date_of_birth,
       is_nri,
       country,
       company_works_at,
       is_married,
       anniversary_date,
       address
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
     RETURNING ${CONTACT_COLUMNS}`,
    [
      contact.account_id ?? null,
      contact.first_name,
      contact.last_name ?? null,
      contact.phone_number ?? null,
      contact.alternate_phone_number ?? null,
      contact.email ?? null,
      contact.date_of_birth ?? null,
      contact.is_nri ?? false,
      contact.country ?? null,
      contact.company_works_at ?? null,
      contact.is_married ?? false,
      contact.anniversary_date ?? null,
      contact.address ?? null,
    ],
  );
  const created = result.rows[0] as ContactRow;
  await addTimelineEvent(
    client,
    created.contact_id,
    "created",
    "Contact created",
    {
      account_id: created.account_id,
    },
  );
  return created;
}

function normalizeAlias(type: string, value: string): string {
  return type === "phone" || type === "alternate_phone"
    ? value.replace(/\D/g, "")
    : value.trim().toLowerCase().replace(/\s+/g, " ");
}

async function preserveChangedAliases(
  client: PoolClient,
  existing: Record<string, unknown>,
  contact: ContactWrite,
): Promise<void> {
  const aliases: { type: string; value: string }[] = [];
  const nameWasProvided =
    contact.first_name !== undefined || contact.last_name !== undefined;
  const nextFirstName = contact.first_name ?? existing.first_name;
  const nextLastName =
    contact.last_name === undefined ? existing.last_name : contact.last_name;
  if (
    nameWasProvided &&
    (nextFirstName !== existing.first_name ||
      nextLastName !== existing.last_name)
  ) {
    const oldName = [existing.first_name, existing.last_name]
      .filter((value) => typeof value === "string" && value.length > 0)
      .join(" ");
    if (oldName) {
      aliases.push({ type: "name", value: oldName });
    }
  }
  for (const [field, type] of [
    ["email", "email"],
    ["phone_number", "phone"],
    ["alternate_phone_number", "alternate_phone"],
  ] as const) {
    if (contact[field] !== undefined && contact[field] !== existing[field]) {
      const oldValue = existing[field];
      if (typeof oldValue === "string" && oldValue.length > 0) {
        aliases.push({ type, value: oldValue });
      }
    }
  }

  for (const alias of aliases) {
    await client.query(
      `INSERT INTO contact_aliases (
         contact_id,
         alias_type,
         alias_value,
         normalized_value
       )
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (contact_id, alias_type, normalized_value) DO NOTHING`,
      [
        existing.contact_id,
        alias.type,
        alias.value,
        normalizeAlias(alias.type, alias.value),
      ],
    );
  }
}

export async function updateContact(
  client: PoolClient,
  existing: Record<string, unknown> & { contact_id: string },
  contact: ContactWrite,
): Promise<ContactRow> {
  const fields = CONTACT_FIELDS.filter((field) => contact[field] !== undefined);
  await preserveChangedAliases(client, existing, contact);
  const values = fields.map((field) => contact[field]);
  const assignments = fields.map((field, index) => `${field} = $${index + 1}`);
  values.push(existing.contact_id);
  const result: QueryResult<ContactRow> = await client.query(
    `UPDATE contacts
     SET ${assignments.join(", ")}, updated_at = CURRENT_TIMESTAMP
     WHERE contact_id = $${values.length} AND archived_at IS NULL
     RETURNING ${CONTACT_COLUMNS}`,
    values,
  );
  await addTimelineEvent(
    client,
    existing.contact_id,
    "updated",
    "Contact updated",
    {
      changed_fields: fields,
    },
  );
  return result.rows[0];
}
