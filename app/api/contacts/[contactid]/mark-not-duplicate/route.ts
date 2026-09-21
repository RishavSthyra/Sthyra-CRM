import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { validateNotDuplicatePayload } from "@/lib/contactDuplicates";
import { parseContactId } from "@/lib/contacts";

type ContactContext = { params: Promise<{ contactid: string }> };

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
  const validation = validateNotDuplicatePayload(body);
  if (!validation.ok) {
    return NextResponse.json(
      { error: "Validation failed", details: validation.errors },
      { status: 422 },
    );
  }
  if (contactId === validation.candidateContactId) {
    return NextResponse.json(
      { error: "A contact cannot be compared with itself" },
      { status: 422 },
    );
  }
  const [low, high] = [contactId, validation.candidateContactId].sort();
  try {
    const contacts = await pool.query(
      `SELECT contact_id FROM contacts
       WHERE contact_id = ANY($1::uuid[])
         AND archived_at IS NULL
         AND merged_into_contact_id IS NULL`,
      [[low, high]],
    );
    if (contacts.rowCount !== 2) {
      return NextResponse.json(
        { error: "Both contacts must exist and be active" },
        { status: 422 },
      );
    }
    const result = await pool.query(
      `INSERT INTO contact_duplicate_exclusions (
         contact_id_low, contact_id_high, reason
       )
       VALUES ($1, $2, $3)
       ON CONFLICT (contact_id_low, contact_id_high)
       DO UPDATE SET reason = EXCLUDED.reason
       RETURNING exclusion_id, contact_id_low, contact_id_high, reason, created_at`,
      [low, high, validation.reason],
    );
    return NextResponse.json({
      message: "Contacts marked as not duplicates",
      exclusion: result.rows[0],
    });
  } catch (error) {
    console.error("Failed to mark contacts as not duplicates", error);
    return NextResponse.json(
      { error: "Unable to mark contacts as not duplicates" },
      { status: 500 },
    );
  }
}
