import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { validateUnmergePayload } from "@/lib/contactDuplicates";
import { addTimelineEvent, parseContactId } from "@/lib/contacts";

type ContactContext = { params: Promise<{ contactid: string }> };

type AppliedChange = { before: unknown; after: unknown };

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
  const validation = validateUnmergePayload(body);
  if (!validation.ok) {
    return NextResponse.json(
      { error: "Validation failed", details: validation.errors },
      { status: 422 },
    );
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const historyResult = await client.query(
      `SELECT * FROM contact_merge_history
       WHERE merge_id = $1
         AND survivor_contact_id = $2
         AND unmerged_at IS NULL
       FOR UPDATE`,
      [validation.mergeId, survivorId],
    );
    if (historyResult.rowCount === 0) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: "Active merge not found" },
        { status: 404 },
      );
    }
    const history = historyResult.rows[0];
    const contactsResult = await client.query(
      `SELECT * FROM contacts
       WHERE contact_id = ANY($1::uuid[])
       ORDER BY contact_id
       FOR UPDATE`,
      [[survivorId, history.duplicate_contact_id]],
    );
    const contacts = new Map(
      contactsResult.rows.map((contact) => [
        contact.contact_id as string,
        contact,
      ]),
    );
    const survivor = contacts.get(survivorId);
    const duplicate = contacts.get(history.duplicate_contact_id);
    if (
      !survivor ||
      !duplicate ||
      duplicate.merged_into_contact_id !== survivorId
    ) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: "Merge state is inconsistent" },
        { status: 409 },
      );
    }

    const appliedFields = history.applied_fields as Record<
      string,
      AppliedChange
    >;
    const restorable = Object.entries(appliedFields).filter(
      ([field, change]) => survivor[field] === change.after,
    );
    if (restorable.length > 0) {
      const values = restorable.map(([, change]) => change.before);
      const assignments = restorable.map(
        ([field], index) => `${field} = $${index + 1}`,
      );
      values.push(survivorId);
      await client.query(
        `UPDATE contacts
         SET ${assignments.join(", ")}, updated_at = CURRENT_TIMESTAMP
         WHERE contact_id = $${values.length}`,
        values,
      );
    }
    const duplicateBefore = history.duplicate_before as Record<string, unknown>;
    await client.query(
      `UPDATE contacts
       SET merged_into_contact_id = NULL,
           archived_at = $1,
           updated_at = CURRENT_TIMESTAMP
       WHERE contact_id = $2`,
      [duplicateBefore.archived_at ?? null, history.duplicate_contact_id],
    );
    await client.query("DELETE FROM contact_aliases WHERE merge_id = $1", [
      validation.mergeId,
    ]);
    await client.query(
      `UPDATE contact_merge_history
       SET unmerged_at = CURRENT_TIMESTAMP, unmerge_notes = $1
       WHERE merge_id = $2`,
      [validation.notes, validation.mergeId],
    );
    await addTimelineEvent(
      client,
      survivorId,
      "contact_unmerged",
      "Contact merge reversed",
      {
        merge_id: validation.mergeId,
        restored_fields: restorable.map(([field]) => field),
      },
    );
    await addTimelineEvent(
      client,
      history.duplicate_contact_id,
      "contact_unmerged",
      "Contact restored after unmerge",
      { merge_id: validation.mergeId, survivor_contact_id: survivorId },
    );
    await client.query("COMMIT");
    return NextResponse.json({
      message: "Contacts unmerged",
      merge_id: validation.mergeId,
      restored_contact_id: history.duplicate_contact_id,
      restored_fields: restorable.map(([field]) => field),
      skipped_fields: Object.keys(appliedFields).filter(
        (field) => !restorable.some(([restored]) => restored === field),
      ),
    });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    console.error("Failed to unmerge contacts", error);
    return NextResponse.json(
      { error: "Unable to unmerge contacts" },
      { status: 500 },
    );
  } finally {
    client.release();
  }
}
