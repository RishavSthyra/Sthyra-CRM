import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { CONSENT_COLUMNS, parseConsentId } from "@/lib/consents";
import { addTimelineEvent, parseContactId } from "@/lib/contacts";

type ConsentContext = {
  params: Promise<{ contactid: string; consentid: string }>;
};

export async function POST(_request: NextRequest, context: ConsentContext) {
  const parameters = await context.params;
  const contactId = parseContactId(parameters.contactid);
  const consentId = parseConsentId(parameters.consentid);
  if (!contactId || !consentId) {
    return NextResponse.json(
      { error: "contactId and consentId must be valid UUIDs" },
      { status: 400 },
    );
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `UPDATE contact_consents
       SET status = 'withdrawn',
           withdrawn_at = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP
       WHERE consent_id = $1 AND contact_id = $2 AND status = 'granted'
       RETURNING ${CONSENT_COLUMNS}`,
      [consentId, contactId],
    );
    if (result.rowCount === 0) {
      const existing = await client.query(
        "SELECT status FROM contact_consents WHERE consent_id = $1 AND contact_id = $2",
        [consentId, contactId],
      );
      await client.query("ROLLBACK");
      if (existing.rowCount === 0) {
        return NextResponse.json(
          { error: "Consent not found" },
          { status: 404 },
        );
      }
      return NextResponse.json(
        { error: "Consent is already withdrawn" },
        { status: 409 },
      );
    }
    await addTimelineEvent(
      client,
      contactId,
      "consent_withdrawn",
      "Consent withdrawn",
      {
        consent_id: consentId,
        consent_type: result.rows[0].consent_type,
        channel: result.rows[0].channel,
      },
    );
    await client.query("COMMIT");
    return NextResponse.json({
      message: "Consent withdrawn",
      consent: result.rows[0],
    });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    console.error("Failed to withdraw consent", error);
    return NextResponse.json(
      { error: "Unable to withdraw consent" },
      { status: 500 },
    );
  } finally {
    client.release();
  }
}
