import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { validateMergePayload } from "@/lib/contactDuplicates";
import {
  addTimelineEvent,
  CONTACT_COLUMNS,
  parseContactId,
} from "@/lib/contacts";

type ContactContext = { params: Promise<{ contactid: string }> };

const INHERITABLE_FIELDS = [
  "account_id",
  "last_name",
  "phone_number",
  "alternate_phone_number",
  "email",
  "date_of_birth",
  "country",
  "company_works_at",
  "anniversary_date",
  "address",
] as const;

function normalizedAlias(type: string, value: string): string {
  return type === "phone" || type === "alternate_phone"
    ? value.replace(/\D/g, "")
    : value.trim().toLowerCase().replace(/\s+/g, " ");
}

export async function POST(request: NextRequest, context: ContactContext) {
  const survivorId = parseContactId((await context.params).contactid);
  if (!survivorId) {
    return NextResponse.json(
      { error: "contactId must be a valid UUID" },
      { status: 400 },
    );
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Request body must contain valid JSON" },
      { status: 400 },
    );
  }
  const validation = validateMergePayload(body);
  if (!validation.ok) {
    return NextResponse.json(
      { error: "Validation failed", details: validation.errors },
      { status: 422 },
    );
  }
  const duplicateId = validation.contactId;
  if (survivorId === duplicateId) {
    return NextResponse.json(
      { error: "A contact cannot be merged with itself" },
      { status: 422 },
    );
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const contactsResult = await client.query(
      `SELECT * FROM contacts
       WHERE contact_id = ANY($1::uuid[])
       ORDER BY contact_id
       FOR UPDATE`,
      [[survivorId, duplicateId]],
    );
    const contacts = new Map(
      contactsResult.rows.map((contact) => [
        contact.contact_id as string,
        contact,
      ]),
    );
    const survivor = contacts.get(survivorId);
    const duplicate = contacts.get(duplicateId);
    if (!survivor || survivor.archived_at || survivor.merged_into_contact_id) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: "Surviving contact is not active" },
        { status: 422 },
      );
    }
    if (
      !duplicate ||
      duplicate.archived_at ||
      duplicate.merged_into_contact_id
    ) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: "Duplicate contact is not active" },
        { status: 422 },
      );
    }
    const exclusion = await client.query(
      `SELECT exclusion_id FROM contact_duplicate_exclusions
       WHERE (contact_id_low = $1 AND contact_id_high = $2)
          OR (contact_id_low = $2 AND contact_id_high = $1)`,
      [survivorId, duplicateId],
    );
    if (exclusion.rowCount !== 0) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: "These contacts were marked as not duplicates" },
        { status: 409 },
      );
    }

    const appliedFields: Record<string, { before: unknown; after: unknown }> =
      {};
    for (const field of INHERITABLE_FIELDS) {
      if (survivor[field] == null && duplicate[field] != null) {
        appliedFields[field] = {
          before: survivor[field],
          after: duplicate[field],
        };
      }
    }
    const historyResult = await client.query(
      `INSERT INTO contact_merge_history (
         survivor_contact_id,
         duplicate_contact_id,
         survivor_before,
         duplicate_before,
         applied_fields
       )
       VALUES ($1, $2, $3::jsonb, $4::jsonb, $5::jsonb)
       RETURNING merge_id, merged_at`,
      [
        survivorId,
        duplicateId,
        JSON.stringify(survivor),
        JSON.stringify(duplicate),
        JSON.stringify(appliedFields),
      ],
    );
    const mergeId = historyResult.rows[0].merge_id as string;

    const fields = Object.keys(appliedFields);
    if (fields.length > 0) {
      const values = fields.map((field) => appliedFields[field].after);
      const assignments = fields.map(
        (field, index) => `${field} = $${index + 1}`,
      );
      values.push(survivorId);
      await client.query(
        `UPDATE contacts
         SET ${assignments.join(", ")}, updated_at = CURRENT_TIMESTAMP
         WHERE contact_id = $${values.length}`,
        values,
      );
    }

    const aliases = [
      {
        type: "name",
        value: [duplicate.first_name, duplicate.last_name]
          .filter(Boolean)
          .join(" "),
      },
      { type: "email", value: duplicate.email },
      { type: "phone", value: duplicate.phone_number },
      { type: "alternate_phone", value: duplicate.alternate_phone_number },
    ].filter(
      (alias): alias is { type: string; value: string } =>
        typeof alias.value === "string" && alias.value.length > 0,
    );
    for (const alias of aliases) {
      await client.query(
        `INSERT INTO contact_aliases (
           contact_id, alias_type, alias_value, normalized_value, source, merge_id
         )
         VALUES ($1, $2, $3, $4, 'contact_merge', $5)
         ON CONFLICT (contact_id, alias_type, normalized_value) DO NOTHING`,
        [
          survivorId,
          alias.type,
          alias.value,
          normalizedAlias(alias.type, alias.value),
          mergeId,
        ],
      );
    }
    await client.query(
      `UPDATE contacts
       SET merged_into_contact_id = $1,
           archived_at = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP
       WHERE contact_id = $2`,
      [survivorId, duplicateId],
    );
    await addTimelineEvent(
      client,
      survivorId,
      "contact_merged",
      "Duplicate contact merged",
      {
        merge_id: mergeId,
        duplicate_contact_id: duplicateId,
        inherited_fields: fields,
      },
    );
    await addTimelineEvent(
      client,
      duplicateId,
      "merged_into_contact",
      "Merged into another contact",
      {
        merge_id: mergeId,
        survivor_contact_id: survivorId,
      },
    );
    const result = await client.query(
      `SELECT ${CONTACT_COLUMNS} FROM contacts WHERE contact_id = $1`,
      [survivorId],
    );
    await client.query("COMMIT");
    return NextResponse.json({
      message: "Contacts merged",
      merge_id: mergeId,
      contact: result.rows[0],
    });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    console.error("Failed to merge contacts", error);
    return NextResponse.json(
      { error: "Unable to merge contacts" },
      { status: 500 },
    );
  } finally {
    client.release();
  }
}
