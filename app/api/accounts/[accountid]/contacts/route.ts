import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { parseAccountId } from "@/lib/accounts";
import {
  CONTACT_COLUMNS,
  createContact,
  validateContactPayload,
} from "@/lib/contacts";
import { getDatabaseErrorCode } from "@/utils/getDatabaseErrorCode";
import { parsePagination } from "@/utils/parsePagination";

type AccountContext = { params: Promise<{ accountid: string }> };

export async function GET(request: NextRequest, context: AccountContext) {
  const accountId = parseAccountId((await context.params).accountid);
  if (!accountId) {
    return NextResponse.json(
      { error: "accountId must be a valid UUID" },
      { status: 400 },
    );
  }
  const pagination = parsePagination(request.nextUrl.searchParams);
  if (!pagination.ok) {
    return NextResponse.json({ error: pagination.error }, { status: 400 });
  }

  try {
    const accountResult = await pool.query(
      "SELECT account_id FROM accounts WHERE account_id = $1 AND archived_at IS NULL",
      [accountId],
    );
    if (accountResult.rowCount === 0) {
      return NextResponse.json({ error: "Account not found" }, { status: 404 });
    }
    const countResult = await pool.query(
      `SELECT COUNT(*)::integer AS total
       FROM contacts
       WHERE account_id = $1 AND archived_at IS NULL`,
      [accountId],
    );
    const result = await pool.query(
      `SELECT ${CONTACT_COLUMNS}
       FROM contacts
       WHERE account_id = $1 AND archived_at IS NULL
       ORDER BY first_name ASC, last_name ASC NULLS LAST, contact_id ASC
       LIMIT $2 OFFSET $3`,
      [accountId, pagination.limit, pagination.offset],
    );
    const total = Number(countResult.rows[0]?.total ?? 0);
    return NextResponse.json({
      contacts: result.rows,
      pagination: {
        page: pagination.page,
        limit: pagination.limit,
        total,
        totalPages: Math.ceil(total / pagination.limit),
      },
    });
  } catch (error) {
    console.error("Failed to list account contacts", error);
    return NextResponse.json(
      { error: "Unable to retrieve account contacts" },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest, context: AccountContext) {
  const accountId = parseAccountId((await context.params).accountid);
  if (!accountId) {
    return NextResponse.json(
      { error: "accountId must be a valid UUID" },
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
  const validation = validateContactPayload(body, { partial: false });
  if (!validation.ok) {
    return NextResponse.json(
      { error: "Validation failed", details: validation.errors },
      { status: 422 },
    );
  }
  if (
    validation.data.account_id !== undefined &&
    validation.data.account_id !== null &&
    validation.data.account_id !== accountId
  ) {
    return NextResponse.json(
      { error: "account_id must match the accountId in the URL" },
      { status: 422 },
    );
  }
  validation.data.account_id = accountId;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const accountResult = await client.query(
      `SELECT account_id
       FROM accounts
       WHERE account_id = $1 AND archived_at IS NULL
       FOR UPDATE`,
      [accountId],
    );
    if (accountResult.rowCount === 0) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "Account not found" }, { status: 404 });
    }
    const contact = await createContact(client, validation.data);
    await client.query("COMMIT");
    return NextResponse.json(
      { message: "Contact created", contact },
      { status: 201 },
    );
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    const code = getDatabaseErrorCode(error);
    if (code === "23503" || code === "23514") {
      return NextResponse.json(
        { error: "Invalid contact data" },
        { status: 422 },
      );
    }
    console.error("Failed to create account contact", error);
    return NextResponse.json(
      { error: "Unable to create contact" },
      { status: 500 },
    );
  } finally {
    client.release();
  }
}
