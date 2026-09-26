import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { parseActivityUuid } from "@/lib/activities";
import { canAccessOperationsEntity, requireOperationsContext } from "@/lib/operationsAccess";
import { TERMINAL_CALL_STATUSES, addCallHistory, validateDisposition } from "@/lib/telephony";

type Context = { params: Promise<{ callid: string }> };
export async function POST(request: NextRequest, context: Context) {
  const scope = await requireOperationsContext(request); if (!scope.ok) return scope.response;
  const callId = parseActivityUuid((await context.params).callid);
  if (!callId) return NextResponse.json({ error: "callId must be a valid UUID" }, { status: 400 });
  let body: unknown; try { body = await request.json(); } catch { return NextResponse.json({ error: "Request body must contain valid JSON" }, { status: 400 }); }
  const validation = validateDisposition(body);
  if (!validation.ok) return NextResponse.json({ error: "Validation failed", details: validation.errors }, { status: 422 });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const found = await client.query("SELECT * FROM calls WHERE call_id=$1 FOR UPDATE", [callId]);
    if (!found.rowCount) { await client.query("ROLLBACK"); return NextResponse.json({ error: "Call not found" }, { status: 404 }); }
    const call = found.rows[0];
    if (!canAccessOperationsEntity(scope.context.access, Number(call.company_id), Number(call.project_id))) { await client.query("ROLLBACK"); return NextResponse.json({ error: "You do not have access to this call" }, { status: 403 }); }
    if (!TERMINAL_CALL_STATUSES.has(String(call.status))) { await client.query("ROLLBACK"); return NextResponse.json({ error: "End the call before applying a disposition" }, { status: 409 }); }
    const result = await client.query(`UPDATE calls SET outcome=$1, summary=COALESCE($2,summary), updated_by=$3, updated_at=CURRENT_TIMESTAMP WHERE call_id=$4 RETURNING *`, [validation.data.outcome, validation.data.summary ?? null, scope.context.userId, callId]);
    await addCallHistory(client, callId, "disposition", String(call.status), String(call.status), scope.context.userId, { outcome: validation.data.outcome });
    await client.query("COMMIT");
    return NextResponse.json({ message: "Call disposition saved", call: result.rows[0] });
  } catch (error) { await client.query("ROLLBACK").catch(() => undefined); console.error("Failed to disposition call", error); return NextResponse.json({ error: "Unable to save call disposition" }, { status: 500 }); }
  finally { client.release(); }
}
