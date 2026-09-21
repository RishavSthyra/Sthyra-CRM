import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { CONSENT_COLUMNS, validateConsentPayload } from "@/lib/consents";
import { addTimelineEvent, parseContactId } from "@/lib/contacts";
import { getDatabaseErrorCode } from "@/utils/getDatabaseErrorCode";
import { parsePagination } from "@/utils/parsePagination";

type ContactContext = { params: Promise<{ contactid: string }> };

export async function GET(request: NextRequest, context: ContactContext) {
  const contactId = parseContactId((await context.params).contactid);
  if (!contactId) {
    return NextResponse.json(
      { error: "contactId must be a valid UUID" },
      { status: 400 },
    );
  }
  const pagination = parsePagination(request.nextUrl.searchParams);
  if (!pagination.ok) {
    return NextResponse.json({ error: pagination.error }, { status: 400 });
  }
  try {
    const contactResult = await pool.query(
      "SELECT contact_id FROM contacts WHERE contact_id = $1 AND archived_at IS NULL",
      [contactId],
    );
    if (contactResult.rowCount === 0) {
      return NextResponse.json({ error: "Contact not found" }, { status: 404 });
    }
    const countResult = await pool.query(
      "SELECT COUNT(*)::integer AS total FROM contact_consents WHERE contact_id = $1",
      [contactId],
    );
    const result = await pool.query(
      `SELECT ${CONSENT_COLUMNS}
       FROM contact_consents
       WHERE contact_id = $1
       ORDER BY created_at DESC, consent_id DESC
       LIMIT $2 OFFSET $3`,
      [contactId, pagination.limit, pagination.offset],
    );
    const total = Number(countResult.rows[0]?.total ?? 0);
    return NextResponse.json({
      consents: result.rows,
      pagination: {
        page: pagination.page,
        limit: pagination.limit,
        total,
        totalPages: Math.ceil(total / pagination.limit),
      },
    });
  } catch (error) {
    console.error("Failed to list contact consents", error);
    return NextResponse.json(
      { error: "Unable to retrieve consents" },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest, context: ContactContext) {
  const contactId = parseContactId((await context.params).contactid);
  if (!contactId) {
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
  const validation = validateConsentPayload(body);
  if (!validation.ok) {
    return NextResponse.json(
      { error: "Validation failed", details: validation.errors },
      { status: 422 },
    );
  }
  const consent = validation.data;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const contactResult = await client.query(
      `SELECT contact_id FROM contacts
       WHERE contact_id = $1 AND archived_at IS NULL AND merged_into_contact_id IS NULL
       FOR UPDATE`,
      [contactId],
    );
    if (contactResult.rowCount === 0) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "Contact not found" }, { status: 404 });
    }
    await client.query(
      `UPDATE contact_consents
       SET status = 'withdrawn',
           withdrawn_at = expires_at,
           updated_at = CURRENT_TIMESTAMP
       WHERE contact_id = $1
         AND consent_type = $2
         AND channel = $3
         AND status = 'granted'
         AND expires_at <= CURRENT_TIMESTAMP`,
      [contactId, consent.consent_type, consent.channel],
    );
    const result = await client.query(
      `INSERT INTO contact_consents (
         contact_id,
         consent_type,
         channel,
         legal_basis,
         source,
         notes,
         expires_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING ${CONSENT_COLUMNS}`,
      [
        contactId,
        consent.consent_type,
        consent.channel,
        consent.legal_basis ?? null,
        consent.source ?? null,
        consent.notes ?? null,
        consent.expires_at ?? null,
      ],
    );
    await addTimelineEvent(
      client,
      contactId,
      "consent_granted",
      "Consent granted",
      {
        consent_id: result.rows[0].consent_id,
        consent_type: consent.consent_type,
        channel: consent.channel,
      },
    );
    await client.query("COMMIT");
    return NextResponse.json(
      { message: "Consent recorded", consent: result.rows[0] },
      { status: 201 },
    );
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    if (getDatabaseErrorCode(error) === "23505") {
      return NextResponse.json(
        { error: "An active consent already exists for this type and channel" },
        { status: 409 },
      );
    }
    console.error("Failed to create contact consent", error);
    return NextResponse.json(
      { error: "Unable to record consent" },
      { status: 500 },
    );
  } finally {
    client.release();
  }
}
