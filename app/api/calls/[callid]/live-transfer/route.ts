import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { parseActivityUuid } from "@/lib/activities";
import { canAccessOperationsEntity, requireOperationsContext } from "@/lib/operationsAccess";
import { ACTIVE_CALL_STATUSES, addCallHistory, providerRequest, validateTransfer } from "@/lib/telephony";

type Context = { params: Promise<{ callid: string }> };
export async function POST(request: NextRequest, context: Context) {
  const scope = await requireOperationsContext(request); if (!scope.ok) return scope.response;
  const callId = parseActivityUuid((await context.params).callid);
  if (!callId) return NextResponse.json({ error: "callId must be a valid UUID" }, { status: 400 });
  let body: unknown; try { body = await request.json(); } catch { return NextResponse.json({ error: "Request body must contain valid JSON" }, { status: 400 }); }
  const validation = validateTransfer(body);
  if (!validation.ok) return NextResponse.json({ error: "Validation failed", details: validation.errors }, { status: 422 });
  try {
    const found = await pool.query("SELECT * FROM calls WHERE call_id=$1", [callId]);
    if (!found.rowCount) return NextResponse.json({ error: "Call not found" }, { status: 404 });
    const call = found.rows[0];
    if (!canAccessOperationsEntity(scope.context.access, Number(call.company_id), Number(call.project_id))) return NextResponse.json({ error: "You do not have access to this call" }, { status: 403 });
    if (!ACTIVE_CALL_STATUSES.has(String(call.status))) return NextResponse.json({ error: "Only an active call can be transferred" }, { status: 409 });
    if (!call.provider_call_id) return NextResponse.json({ error: "This call has no live provider session" }, { status: 409 });
    if (validation.data.to_user_id) {
      const target = await pool.query(`SELECT 1 FROM users u JOIN teams t ON t.team_id=u.team_id WHERE u.user_id=$1 AND t.company_id=$2 AND u.is_active=TRUE AND u.deleted_at IS NULL`, [validation.data.to_user_id, call.company_id]);
      if (!target.rowCount) return NextResponse.json({ error: "Target user was not found in this company" }, { status: 422 });
    }
    if (validation.data.to_team_id) {
      const target = await pool.query("SELECT 1 FROM teams WHERE team_id=$1 AND company_id=$2 AND is_active=TRUE", [validation.data.to_team_id, call.company_id]);
      if (!target.rowCount) return NextResponse.json({ error: "Target team was not found in this company" }, { status: 422 });
    }
    const provider = await providerRequest(`/calls/${encodeURIComponent(call.provider_call_id)}/actions/live-transfer`, "POST", validation.data);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const inserted = await client.query(`INSERT INTO call_transfers (call_id, from_user_id, to_user_id, to_team_id, to_phone_number, status, provider_transfer_id, metadata, requested_by, completed_at) VALUES ($1,$2,$3,$4,$5,'completed',$6,$7,$2,CURRENT_TIMESTAMP) RETURNING *`, [callId, scope.context.userId, validation.data.to_user_id ?? null, validation.data.to_team_id ?? null, validation.data.to_phone_number ?? null, provider.id ?? provider.transfer_id ?? null, provider]);
      if (validation.data.to_user_id) await client.query("UPDATE calls SET owner_user_id=$1, updated_by=$2, updated_at=CURRENT_TIMESTAMP WHERE call_id=$3", [validation.data.to_user_id, scope.context.userId, callId]);
      await addCallHistory(client, callId, "live_transfer", String(call.status), String(call.status), scope.context.userId, validation.data);
      await client.query("COMMIT");
      return NextResponse.json({ message: "Call transferred", transfer: inserted.rows[0] });
    } catch (error) { await client.query("ROLLBACK").catch(() => undefined); throw error; } finally { client.release(); }
  } catch (error) {
    if (error instanceof Error && error.message === "TELEPHONY_NOT_CONFIGURED") return NextResponse.json({ error: "Telephony provider is not configured" }, { status: 503 });
    console.error("Failed to transfer call", error); return NextResponse.json({ error: "Unable to transfer call" }, { status: 502 });
  }
}
