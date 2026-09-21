import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { CONSENT_CHANNELS } from "@/lib/consents";
import { parseContactId } from "@/lib/contacts";

type ContactContext = { params: Promise<{ contactid: string }> };

export async function GET(_request: NextRequest, context: ContactContext) {
  const contactId = parseContactId((await context.params).contactid);
  if (!contactId) {
    return NextResponse.json(
      { error: "contactId must be a valid UUID" },
      { status: 400 },
    );
  }
  try {
    const contactResult = await pool.query(
      "SELECT contact_id FROM contacts WHERE contact_id = $1 AND archived_at IS NULL",
      [contactId],
    );
    if (contactResult.rowCount === 0) {
      return NextResponse.json({ error: "Contact not found" }, { status: 404 });
    }
    const result = await pool.query(
      `SELECT DISTINCT cc.channel
       FROM contact_consents cc
       JOIN contacts source_contact ON source_contact.contact_id = cc.contact_id
       WHERE (
           cc.contact_id = $1
           OR source_contact.merged_into_contact_id = $1
         )
         AND cc.status = 'granted'
         AND (cc.expires_at IS NULL OR cc.expires_at > CURRENT_TIMESTAMP)`,
      [contactId],
    );
    const allowed = new Set(
      result.rows.map((row: { channel: string }) => row.channel),
    );
    return NextResponse.json({
      contact_id: contactId,
      permissions: Object.fromEntries(
        CONSENT_CHANNELS.map((channel) => [channel, allowed.has(channel)]),
      ),
    });
  } catch (error) {
    console.error("Failed to calculate communication permissions", error);
    return NextResponse.json(
      { error: "Unable to retrieve communication permissions" },
      { status: 500 },
    );
  }
}
