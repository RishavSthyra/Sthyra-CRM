import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { parseActivityUuid } from "@/lib/activities";
import { CALL_COLUMNS } from "@/lib/communications";
import { canAccessOperationsEntity, requireOperationsContext } from "@/lib/operationsAccess";

type Context = { params: Promise<{ callid: string }> };
export async function GET(request: NextRequest, context: Context) {
  const scope = await requireOperationsContext(request); if (!scope.ok) return scope.response;
  const callId = parseActivityUuid((await context.params).callid);
  if (!callId) return NextResponse.json({ error: "callId must be a valid UUID" }, { status: 400 });
  try {
    const result = await pool.query(`SELECT ${CALL_COLUMNS}, p.project_name, ct.first_name AS contact_first_name, ct.last_name AS contact_last_name FROM calls c JOIN projects p ON p.project_id=c.project_id LEFT JOIN contacts ct ON ct.contact_id=c.contact_id WHERE c.call_id=$1`, [callId]);
    if (!result.rowCount) return NextResponse.json({ error: "Call not found" }, { status: 404 });
    const call = result.rows[0];
    if (!canAccessOperationsEntity(scope.context.access, Number(call.company_id), Number(call.project_id))) return NextResponse.json({ error: "You do not have access to this call" }, { status: 403 });
    const [history, transfers] = await Promise.all([
      pool.query("SELECT * FROM call_state_history WHERE call_id=$1 ORDER BY created_at, history_id", [callId]),
      pool.query("SELECT * FROM call_transfers WHERE call_id=$1 ORDER BY created_at, transfer_id", [callId]),
    ]);
    return NextResponse.json({ call, history: history.rows, transfers: transfers.rows });
  } catch (error) { console.error("Failed to retrieve call", error); return NextResponse.json({ error: "Unable to retrieve call" }, { status: 500 }); }
}
