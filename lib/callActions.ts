import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { parseActivityUuid } from "@/lib/activities";
import { canAccessOperationsEntity, requireOperationsContext } from "@/lib/operationsAccess";
import { ACTIVE_CALL_STATUSES, TERMINAL_CALL_STATUSES, addCallHistory, providerRequest } from "@/lib/telephony";

export type CallAction = "end" | "hold" | "resume" | "mute" | "unmute";

function transition(call: Record<string, unknown>, action: CallAction) {
  const status = String(call.status);
  if (TERMINAL_CALL_STATUSES.has(status)) return { error: "This call has already ended" };
  if (!call.provider_call_id) return { error: "This call was logged manually and has no live provider session" };
  if (action === "hold" && !["answered", "in_progress"].includes(status)) return { error: "Only an active call can be placed on hold" };
  if (action === "resume" && status !== "on_hold") return { error: "Only a call on hold can be resumed" };
  if (["mute", "unmute"].includes(action) && !ACTIVE_CALL_STATUSES.has(status)) return { error: "Only an active call can be muted or unmuted" };
  if (action === "mute" && call.muted === true) return { error: "The call is already muted" };
  if (action === "unmute" && call.muted !== true) return { error: "The call is not muted" };
  const nextStatus = action === "hold" ? "on_hold" : action === "resume" ? "in_progress" : action === "end" ? (["answered", "in_progress", "on_hold"].includes(status) ? "completed" : "cancelled") : status;
  return { nextStatus };
}

export async function performCallAction(request: NextRequest, callIdValue: string, action: CallAction) {
  const scope = await requireOperationsContext(request); if (!scope.ok) return scope.response;
  const callId = parseActivityUuid(callIdValue);
  if (!callId) return NextResponse.json({ error: "callId must be a valid UUID" }, { status: 400 });
  try {
    const found = await pool.query("SELECT * FROM calls WHERE call_id=$1", [callId]);
    if (!found.rowCount) return NextResponse.json({ error: "Call not found" }, { status: 404 });
    const call = found.rows[0];
    if (!canAccessOperationsEntity(scope.context.access, Number(call.company_id), Number(call.project_id))) return NextResponse.json({ error: "You do not have access to this call" }, { status: 403 });
    const state = transition(call, action);
    if (state.error) return NextResponse.json({ error: state.error }, { status: 409 });
    await providerRequest(`/calls/${encodeURIComponent(String(call.provider_call_id))}/actions/${action}`, "POST", { call_id: callId });
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const values: unknown[] = [state.nextStatus, scope.context.userId, callId, call.status];
      const extras = action === "hold" ? ", on_hold=TRUE" : action === "resume" ? ", on_hold=FALSE" : action === "mute" ? ", muted=TRUE" : action === "unmute" ? ", muted=FALSE" : `, ended_at=CURRENT_TIMESTAMP, on_hold=FALSE, muted=FALSE, duration_seconds=GREATEST(0, EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP-COALESCE(answered_at,started_at)))::integer)`;
      const updated = await client.query(`UPDATE calls SET status=$1, updated_by=$2, updated_at=CURRENT_TIMESTAMP ${extras} WHERE call_id=$3 AND status=$4 RETURNING *`, values);
      if (!updated.rowCount) { await client.query("ROLLBACK"); return NextResponse.json({ error: "Call state changed; refresh and try again" }, { status: 409 }); }
      await addCallHistory(client, callId, action, String(call.status), state.nextStatus!, scope.context.userId);
      await client.query("COMMIT");
      return NextResponse.json({ message: `Call ${action} completed`, call: updated.rows[0] });
    } catch (error) { await client.query("ROLLBACK").catch(() => undefined); throw error; }
    finally { client.release(); }
  } catch (error) {
    if (error instanceof Error && error.message === "TELEPHONY_NOT_CONFIGURED") return NextResponse.json({ error: "Telephony provider is not configured" }, { status: 503 });
    console.error(`Failed to ${action} call`, error); return NextResponse.json({ error: `Unable to ${action} call` }, { status: 502 });
  }
}
