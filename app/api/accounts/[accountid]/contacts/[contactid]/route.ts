import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { parseAccountId } from "@/lib/accounts";
import {
  addTimelineEvent,
  CONTACT_COLUMNS,
  parseContactId,
  updateContact,
  validateContactPayload,
} from "@/lib/contacts";
import { getDatabaseErrorCode } from "@/utils/getDatabaseErrorCode";

type ContactContext = {
  params: Promise<{ accountid: string; contactid: string }>;
};

function parseIds(accountid: string, contactid: string) {
  return {
    accountId: parseAccountId(accountid),
    contactId: parseContactId(contactid),
  };
}

export async function PATCH(request: NextRequest, context: ContactContext) {
  const parameters = await context.params;
  const { accountId, contactId } = parseIds(
    parameters.accountid,
    parameters.contactid,
  );
  if (!accountId || !contactId) {
    return NextResponse.json(
      { error: "accountId and contactId must be valid UUIDs" },
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
  if (
    validation.data.account_id !== undefined &&
    validation.data.account_id !== accountId
  ) {
    return NextResponse.json(
      { error: "account_id cannot be changed from this nested endpoint" },
      { status: 422 },
    );
  }
  validation.data.account_id = accountId;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `SELECT * FROM contacts
       WHERE contact_id = $1 AND account_id = $2 AND archived_at IS NULL
       FOR UPDATE`,
      [contactId, accountId],
    );
    if (result.rowCount === 0) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: "Contact not found in account" },
        { status: 404 },
      );
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
    const contact = await updateContact(client, existing, validation.data);
    await client.query("COMMIT");
    return NextResponse.json({ message: "Contact updated", contact });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    if (getDatabaseErrorCode(error) === "23514") {
      return NextResponse.json(
        { error: "Invalid contact data" },
        { status: 422 },
      );
    }
    console.error("Failed to update account contact", error);
    return NextResponse.json(
      { error: "Unable to update contact" },
      { status: 500 },
    );
  } finally {
    client.release();
  }
}

export async function DELETE(_request: NextRequest, context: ContactContext) {
  const parameters = await context.params;
  const { accountId, contactId } = parseIds(
    parameters.accountid,
    parameters.contactid,
  );
  if (!accountId || !contactId) {
    return NextResponse.json(
      { error: "accountId and contactId must be valid UUIDs" },
      { status: 400 },
    );
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `UPDATE contacts
       SET account_id = NULL, updated_at = CURRENT_TIMESTAMP
       WHERE contact_id = $1 AND account_id = $2 AND archived_at IS NULL
       RETURNING ${CONTACT_COLUMNS}`,
      [contactId, accountId],
    );
    if (result.rowCount === 0) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: "Contact not found in account" },
        { status: 404 },
      );
    }
    await addTimelineEvent(
      client,
      contactId,
      "account_unlinked",
      "Removed from account",
      {
        account_id: accountId,
      },
    );
    await client.query("COMMIT");
    return NextResponse.json({
      message: "Contact removed from account",
      contact: result.rows[0],
    });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    console.error("Failed to remove contact from account", error);
    return NextResponse.json(
      { error: "Unable to remove contact from account" },
      { status: 500 },
    );
  } finally {
    client.release();
  }
}
