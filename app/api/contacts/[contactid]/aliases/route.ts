import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
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
      `SELECT alias_id, contact_id, alias_type, alias_value, source, created_at
       FROM contact_aliases
       WHERE contact_id = $1
       ORDER BY created_at DESC, alias_id DESC`,
      [contactId],
    );
    return NextResponse.json({ aliases: result.rows });
  } catch (error) {
    console.error("Failed to retrieve contact aliases", error);
    return NextResponse.json(
      { error: "Unable to retrieve contact aliases" },
      { status: 500 },
    );
  }
}
