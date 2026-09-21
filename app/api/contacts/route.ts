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

export async function GET(request: NextRequest) {
  const pagination = parsePagination(request.nextUrl.searchParams);
  if (!pagination.ok) {
    return NextResponse.json({ error: pagination.error }, { status: 400 });
  }

  const values: unknown[] = [];
  const filters = ["archived_at IS NULL"];
  const accountValue = request.nextUrl.searchParams.get("account_id");
  if (accountValue !== null) {
    const accountId = parseAccountId(accountValue);
    if (!accountId) {
      return NextResponse.json(
        { error: "account_id must be a valid UUID" },
        { status: 400 },
      );
    }
    values.push(accountId);
    filters.push(`account_id = $${values.length}`);
  }
  const whereClause = `WHERE ${filters.join(" AND ")}`;

  try {
    const countResult = await pool.query(
      `SELECT COUNT(*)::integer AS total FROM contacts ${whereClause}`,
      values,
    );
    const listValues = [...values, pagination.limit, pagination.offset];
    const result = await pool.query(
      `SELECT ${CONTACT_COLUMNS}
       FROM contacts
       ${whereClause}
       ORDER BY created_at DESC, contact_id ASC
       LIMIT $${listValues.length - 1}
       OFFSET $${listValues.length}`,
      listValues,
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
    console.error("Failed to list contacts", error);
    return NextResponse.json(
      { error: "Unable to retrieve contacts" },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
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

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
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
    console.error("Failed to create contact", error);
    return NextResponse.json(
      { error: "Unable to create contact" },
      { status: 500 },
    );
  } finally {
    client.release();
  }
}
