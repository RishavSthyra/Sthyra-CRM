import pool from "@/lib/db";
import { createContact, validateContactPayload } from "@/lib/contacts";
import {
  createLead,
  LeadReferenceError,
  validateLeadPayload,
} from "@/lib/leads";
import { isUuid } from "@/lib/permissions";
import { isObject } from "@/utils/isObject";
import { validateText } from "@/utils/validateText";

export const INTAKE_EVENT_COLUMNS = `
  event_id, idempotency_key, payload, status, lead_id, error_code,
  error_message, attempt_count, received_at, last_attempt_at, processed_at,
  resolved_at, resolution_action, resolution_notes, created_at, updated_at
`;

type IntakePayload = {
  idempotency_key: string;
  contact_id?: string;
  contact?: Record<string, unknown>;
  lead: Record<string, unknown>;
};

type IntakeValidation =
  | { ok: true; data: IntakePayload }
  | { ok: false; errors: string[] };

export function validateIntakeEnvelope(body: unknown): IntakeValidation {
  if (!isObject(body) || Array.isArray(body)) {
    return { ok: false, errors: ["Intake event must be a JSON object"] };
  }
  const allowed = new Set(["idempotency_key", "contact_id", "contact", "lead"]);
  const errors = Object.keys(body)
    .filter((field) => !allowed.has(field))
    .map((field) => `Unknown field: ${field}`);
  const key = validateText(
    body.idempotency_key,
    "idempotency_key",
    200,
    false,
    errors,
  );
  if (body.idempotency_key === undefined) {
    errors.push("idempotency_key is required");
  }
  if (body.contact_id !== undefined && !isUuid(body.contact_id)) {
    errors.push("contact_id must be a valid UUID");
  }
  if (
    body.contact !== undefined &&
    (!isObject(body.contact) || Array.isArray(body.contact))
  ) {
    errors.push("contact must be a JSON object");
  }
  if (body.contact_id === undefined && body.contact === undefined) {
    errors.push("contact_id or contact is required");
  }
  if (body.contact_id !== undefined && body.contact !== undefined) {
    errors.push("Provide contact_id or contact, not both");
  }
  if (!isObject(body.lead) || Array.isArray(body.lead)) {
    errors.push("lead must be a JSON object");
  }
  if (body.lead === undefined) {
    errors.push("lead is required");
  }
  if (errors.length || typeof key !== "string" || !isObject(body.lead)) {
    return { ok: false, errors };
  }
  return {
    ok: true,
    data: {
      idempotency_key: key,
      ...(typeof body.contact_id === "string"
        ? { contact_id: body.contact_id.toLowerCase() }
        : {}),
      ...(isObject(body.contact) ? { contact: body.contact } : {}),
      lead: body.lead,
    },
  };
}

class IntakeDataError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "IntakeDataError";
  }
}

export async function createIntakeEvent(
  payload: IntakePayload,
): Promise<{ event: Record<string, unknown>; created: boolean }> {
  const inserted = await pool.query(
    `INSERT INTO lead_intake_events (idempotency_key, payload)
     VALUES ($1, $2::jsonb)
     ON CONFLICT (idempotency_key) DO NOTHING
     RETURNING ${INTAKE_EVENT_COLUMNS}`,
    [payload.idempotency_key, JSON.stringify(payload)],
  );
  if (inserted.rowCount) {
    return { event: inserted.rows[0], created: true };
  }
  const existing = await pool.query(
    `SELECT ${INTAKE_EVENT_COLUMNS} FROM lead_intake_events WHERE idempotency_key=$1`,
    [payload.idempotency_key],
  );
  return { event: existing.rows[0], created: false };
}

async function resolveContact(
  client: import("pg").PoolClient,
  envelope: IntakePayload,
): Promise<string> {
  if (envelope.contact_id) {
    const result = await client.query(
      `SELECT contact_id FROM contacts
       WHERE contact_id=$1 AND archived_at IS NULL AND merged_into_contact_id IS NULL`,
      [envelope.contact_id],
    );
    if (!result.rowCount) {
      throw new IntakeDataError(
        "CONTACT_NOT_FOUND",
        "Active contact not found",
      );
    }
    return envelope.contact_id;
  }
  const validation = validateContactPayload(envelope.contact, {
    partial: false,
  });
  if (!validation.ok) {
    throw new IntakeDataError("INVALID_CONTACT", validation.errors.join("; "));
  }
  const contact = validation.data;
  if (contact.email || contact.phone_number) {
    const existing = await client.query(
      `SELECT contact_id FROM contacts
       WHERE archived_at IS NULL
         AND merged_into_contact_id IS NULL
         AND (
           ($1::text IS NOT NULL AND LOWER(email)=LOWER($1))
           OR ($2::text IS NOT NULL AND REGEXP_REPLACE(phone_number, '\\D', '', 'g')=REGEXP_REPLACE($2, '\\D', '', 'g'))
         )
       ORDER BY created_at ASC LIMIT 1`,
      [contact.email ?? null, contact.phone_number ?? null],
    );
    if (existing.rowCount) {
      return existing.rows[0].contact_id as string;
    }
  }
  const created = await createContact(client, contact);
  return created.contact_id;
}

export async function processIntakeEvent(
  eventId: string,
): Promise<Record<string, unknown>> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const eventResult = await client.query(
      "SELECT * FROM lead_intake_events WHERE event_id=$1 FOR UPDATE",
      [eventId],
    );
    if (!eventResult.rowCount) {
      throw new IntakeDataError("EVENT_NOT_FOUND", "Intake event not found");
    }
    const event = eventResult.rows[0];
    if (event.status === "processed") {
      await client.query("COMMIT");
      return event;
    }
    if (event.status === "discarded") {
      throw new IntakeDataError(
        "EVENT_DISCARDED",
        "Discarded events cannot be replayed",
      );
    }
    const validation = validateIntakeEnvelope(event.payload);
    if (!validation.ok) {
      throw new IntakeDataError("INVALID_EVENT", validation.errors.join("; "));
    }
    const contactId = await resolveContact(client, validation.data);
    const leadValidation = validateLeadPayload(
      { ...validation.data.lead, contact_id: contactId },
      { partial: false },
    );
    if (!leadValidation.ok) {
      throw new IntakeDataError(
        "INVALID_LEAD",
        leadValidation.errors.join("; "),
      );
    }
    const lead = await createLead(client, leadValidation.data, eventId);
    const updated = await client.query(
      `UPDATE lead_intake_events
       SET status='processed', lead_id=$1, error_code=NULL, error_message=NULL,
           attempt_count=attempt_count+1, last_attempt_at=CURRENT_TIMESTAMP,
           processed_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP
       WHERE event_id=$2 RETURNING ${INTAKE_EVENT_COLUMNS}`,
      [lead.lead_id, eventId],
    );
    await client.query("COMMIT");
    return updated.rows[0];
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    const expected =
      error instanceof IntakeDataError || error instanceof LeadReferenceError;
    const code =
      error instanceof IntakeDataError
        ? error.code
        : expected
          ? "INVALID_REFERENCE"
          : "PROCESSING_ERROR";
    const message =
      error instanceof Error
        ? error.message
        : "Unexpected intake processing error";
    if (code === "EVENT_NOT_FOUND") {
      throw error;
    }
    const updated = await pool.query(
      `UPDATE lead_intake_events
       SET status=$1, error_code=$2, error_message=$3,
           attempt_count=attempt_count+1, last_attempt_at=CURRENT_TIMESTAMP,
           updated_at=CURRENT_TIMESTAMP
       WHERE event_id=$4 RETURNING ${INTAKE_EVENT_COLUMNS}`,
      [expected ? "quarantined" : "failed", code, message, eventId],
    );
    if (!expected) {
      console.error("Unexpected lead intake processing failure", error);
    }
    return updated.rows[0];
  } finally {
    client.release();
  }
}
