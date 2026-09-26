import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { requireOperationsContext } from "@/lib/operationsAccess";

export async function GET(request: NextRequest) {
  const scope = await requireOperationsContext(request);
  if (!scope.ok) return scope.response;
  try {
    const result = await pool.query(
      `SELECT email_connection_id, provider, email_address, display_name,
              status, is_default, scopes, last_synced_at, last_error,
              created_at, updated_at
       FROM email_connections
       WHERE company_id=$1 AND user_id=$2 AND status <> 'disconnected'
       ORDER BY is_default DESC, created_at ASC`,
      [scope.context.access.company.company_id, scope.context.userId],
    );
    const response = NextResponse.json({ connections: result.rows });
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error) {
    console.error("Unable to list email connections", error);
    return NextResponse.json(
      { error: "Unable to retrieve connected email accounts" },
      { status: 500 },
    );
  }
}
