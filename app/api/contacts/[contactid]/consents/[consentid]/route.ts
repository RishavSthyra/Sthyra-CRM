import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { CONSENT_COLUMNS, parseConsentId } from "@/lib/consents";
import { parseContactId } from "@/lib/contacts";

type ConsentContext = {
  params: Promise<{ contactid: string; consentid: string }>;
};

export async function GET(_request: NextRequest, context: ConsentContext) {
  const parameters = await context.params;
  const contactId = parseContactId(parameters.contactid);
  const consentId = parseConsentId(parameters.consentid);
  if (!contactId || !consentId) {
    return NextResponse.json(
      { error: "contactId and consentId must be valid UUIDs" },
      { status: 400 },
    );
  }
  try {
    const result = await pool.query(
      `SELECT ${CONSENT_COLUMNS}
       FROM contact_consents
       WHERE consent_id = $1 AND contact_id = $2`,
      [consentId, contactId],
    );
    if (result.rowCount === 0) {
      return NextResponse.json({ error: "Consent not found" }, { status: 404 });
    }
    return NextResponse.json({ consent: result.rows[0] });
  } catch (error) {
    console.error("Failed to retrieve consent", error);
    return NextResponse.json(
      { error: "Unable to retrieve consent" },
      { status: 500 },
    );
  }
}
