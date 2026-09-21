import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { ACCOUNT_COLUMNS, parseAccountId } from "@/lib/accounts";

type AccountContext = { params: Promise<{ accountid: string }> };

export async function POST(_request: NextRequest, context: AccountContext) {
  const accountId = parseAccountId((await context.params).accountid);
  if (!accountId) {
    return NextResponse.json(
      { error: "accountId must be a valid UUID" },
      { status: 400 },
    );
  }
  try {
    const result = await pool.query(
      `UPDATE accounts
       SET archived_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE account_id = $1 AND archived_at IS NULL
       RETURNING ${ACCOUNT_COLUMNS}`,
      [accountId],
    );
    if (result.rowCount === 0) {
      return NextResponse.json({ error: "Account not found" }, { status: 404 });
    }
    return NextResponse.json({
      message: "Account archived",
      account: result.rows[0],
    });
  } catch (error) {
    console.error("Failed to archive account", error);
    return NextResponse.json(
      { error: "Unable to archive account" },
      { status: 500 },
    );
  }
}
