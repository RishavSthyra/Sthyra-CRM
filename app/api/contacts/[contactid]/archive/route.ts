import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import {
  addTimelineEvent,
  CONTACT_COLUMNS,
  parseContactId,
} from "@/lib/contacts";

type ContactContext = { params: Promise<{ contactid: string }> };

export async function POST(_request: NextRequest, context: ContactContext) {
  const contactId = parseContactId((await context.params).contactid);
  if (!contactId) {
    return NextResponse.json(
      { error: "contactId must be a valid UUID" },
      { status: 400 },
    );
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `UPDATE contacts
       SET archived_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE contact_id = $1 AND archived_at IS NULL
       RETURNING ${CONTACT_COLUMNS}`,
      [contactId],
    );
    if (result.rowCount === 0) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "Contact not found" }, { status: 404 });
    }
    await addTimelineEvent(client, contactId, "archived", "Contact archived");
    await client.query("COMMIT");
    return NextResponse.json({
      message: "Contact archived",
      contact: result.rows[0],
    });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    console.error("Failed to archive contact", error);
    return NextResponse.json(
      { error: "Unable to archive contact" },
      { status: 500 },
    );
  } finally {
    client.release();
  }
}
