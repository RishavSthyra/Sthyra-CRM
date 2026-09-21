import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import {
  ACCOUNT_COLUMNS,
  AccountField,
  parseAccountId,
  validateAccountPayload,
} from "@/lib/accounts";

type AccountContext = { params: Promise<{ accountid: string }> };

export async function GET(_request: NextRequest, context: AccountContext) {
  const accountId = parseAccountId((await context.params).accountid);
  if (!accountId) {
    return NextResponse.json(
      { error: "accountId must be a valid UUID" },
      { status: 400 },
    );
  }
  try {
    const result = await pool.query(
      `SELECT ${ACCOUNT_COLUMNS}
       FROM accounts
       WHERE account_id = $1 AND archived_at IS NULL`,
      [accountId],
    );
    if (result.rowCount === 0) {
      return NextResponse.json({ error: "Account not found" }, { status: 404 });
    }
    return NextResponse.json({ account: result.rows[0] });
  } catch (error) {
    console.error("Failed to retrieve account", error);
    return NextResponse.json(
      { error: "Unable to retrieve account" },
      { status: 500 },
    );
  }
}

export async function PATCH(request: NextRequest, context: AccountContext) {
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
  const validation = validateAccountPayload(body, { partial: true });
  if (!validation.ok) {
    return NextResponse.json(
      { error: "Validation failed", details: validation.errors },
      { status: 422 },
    );
  }

  const fields: AccountField[] = ["name", "account_type"];
  const updates = fields
    .filter((field) => validation.data[field] !== undefined)
    .map((field) => ({ field, value: validation.data[field] }));
  const values = updates.map(({ value }) => value);
  const assignments = updates.map(
    ({ field }, index) => `${field} = $${index + 1}`,
  );
  values.push(accountId);
  try {
    const result = await pool.query(
      `UPDATE accounts
       SET ${assignments.join(", ")}, updated_at = CURRENT_TIMESTAMP
       WHERE account_id = $${values.length} AND archived_at IS NULL
       RETURNING ${ACCOUNT_COLUMNS}`,
      values,
    );
    if (result.rowCount === 0) {
      return NextResponse.json({ error: "Account not found" }, { status: 404 });
    }
    return NextResponse.json({
      message: "Account updated",
      account: result.rows[0],
    });
  } catch (error) {
    console.error("Failed to update account", error);
    return NextResponse.json(
      { error: "Unable to update account" },
      { status: 500 },
    );
  }
}
