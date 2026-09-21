import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import {
  CONTACT_COLUMNS,
  parseContactId,
  updateContact,
  validateContactPayload,
} from "@/lib/contacts";
import { getDatabaseErrorCode } from "@/utils/getDatabaseErrorCode";

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
    const result = await pool.query(
      `SELECT ${CONTACT_COLUMNS}
       FROM contacts
       WHERE contact_id = $1 AND archived_at IS NULL`,
      [contactId],
    );
    if (result.rowCount === 0) {
      return NextResponse.json({ error: "Contact not found" }, { status: 404 });
    }
    return NextResponse.json({ contact: result.rows[0] });
  } catch (error) {
    console.error("Failed to retrieve contact", error);
    return NextResponse.json(
      { error: "Unable to retrieve contact" },
      { status: 500 },
    );
  }
}

export async function PATCH(request: NextRequest, context: ContactContext) {
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
  const validation = validateContactPayload(body, { partial: true });
  if (!validation.ok) {
    return NextResponse.json(
      { error: "Validation failed", details: validation.errors },
      { status: 422 },
    );
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `SELECT * FROM contacts
       WHERE contact_id = $1 AND archived_at IS NULL
       FOR UPDATE`,
      [contactId],
    );
    if (result.rowCount === 0) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "Contact not found" }, { status: 404 });
    }
    const existing = result.rows[0];
    const nextPhone =
      validation.data.phone_number === undefined
        ? existing.phone_number
        : validation.data.phone_number;
    const nextEmail =
      validation.data.email === undefined
        ? existing.email
        : validation.data.email;
    if (!nextPhone && !nextEmail) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: "phone_number or email is required" },
        { status: 422 },
      );
    }
    if (validation.data.account_id) {
      const accountResult = await client.query(
        "SELECT account_id FROM accounts WHERE account_id = $1 AND archived_at IS NULL",
        [validation.data.account_id],
      );
      if (accountResult.rowCount === 0) {
        await client.query("ROLLBACK");
        return NextResponse.json(
          { error: "Account not found" },
          { status: 422 },
        );
      }
    }
    const contact = await updateContact(client, existing, validation.data);
    await client.query("COMMIT");
    return NextResponse.json({ message: "Contact updated", contact });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    const code = getDatabaseErrorCode(error);
    if (code === "23503" || code === "23514") {
      return NextResponse.json(
        { error: "Invalid contact data" },
        { status: 422 },
      );
    }
    console.error("Failed to update contact", error);
    return NextResponse.json(
      { error: "Unable to update contact" },
      { status: 500 },
    );
  } finally {
    client.release();
  }
}
