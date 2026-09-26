import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { requireOperationsContext } from "@/lib/operationsAccess";
import { isUuid } from "@/lib/permissions";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const scope = await requireOperationsContext(request);
  if (!scope.ok) return scope.response;
  const { id } = await params;
  if (!isUuid(id)) {
    return NextResponse.json({ error: "Invalid connection id" }, { status: 400 });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const owned = await client.query(
      `SELECT 1 FROM email_connections
       WHERE email_connection_id=$1 AND company_id=$2 AND user_id=$3
         AND status='connected'`,
      [id, scope.context.access.company.company_id, scope.context.userId],
    );
    if (!owned.rowCount) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: "Connected account not found" },
        { status: 404 },
      );
    }
    await client.query(
      `UPDATE email_connections
       SET is_default=FALSE, updated_at=CURRENT_TIMESTAMP
       WHERE user_id=$1`,
      [scope.context.userId],
    );
    await client.query(
      `UPDATE email_connections
       SET is_default=TRUE, updated_at=CURRENT_TIMESTAMP
       WHERE email_connection_id=$1`,
      [id],
    );
    await client.query("COMMIT");
    return NextResponse.json({ message: "Default sender updated" });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    console.error("Unable to update email connection", error);
    return NextResponse.json(
      { error: "Unable to update connected account" },
      { status: 500 },
    );
  } finally {
    client.release();
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const scope = await requireOperationsContext(request);
  if (!scope.ok) return scope.response;
  const { id } = await params;
  if (!isUuid(id)) {
    return NextResponse.json({ error: "Invalid connection id" }, { status: 400 });
  }

  try {
    const result = await pool.query(
      `UPDATE email_connections
       SET status='disconnected', is_default=FALSE,
           access_token_ciphertext=NULL, refresh_token_ciphertext=NULL,
           last_error=NULL, updated_at=CURRENT_TIMESTAMP
       WHERE email_connection_id=$1 AND company_id=$2 AND user_id=$3
         AND status <> 'disconnected'
       RETURNING email_connection_id`,
      [id, scope.context.access.company.company_id, scope.context.userId],
    );
    if (!result.rowCount) {
      return NextResponse.json(
        { error: "Connected account not found" },
        { status: 404 },
      );
    }
    await pool.query(
      `UPDATE email_connections SET is_default=TRUE, updated_at=CURRENT_TIMESTAMP
       WHERE email_connection_id=(
         SELECT email_connection_id FROM email_connections
         WHERE user_id=$1 AND status='connected'
         ORDER BY created_at ASC LIMIT 1
       ) AND NOT EXISTS (
         SELECT 1 FROM email_connections
         WHERE user_id=$1 AND status='connected' AND is_default=TRUE
       )`,
      [scope.context.userId],
    );
    return NextResponse.json({ message: "Email account disconnected" });
  } catch (error) {
    console.error("Unable to disconnect email connection", error);
    return NextResponse.json(
      { error: "Unable to disconnect email account" },
      { status: 500 },
    );
  }
}
