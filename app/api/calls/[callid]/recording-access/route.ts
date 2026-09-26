import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { parseActivityUuid } from "@/lib/activities";
import { canAccessOperationsEntity, requireOperationsContext } from "@/lib/operationsAccess";
import { providerRequest } from "@/lib/telephony";

type Context = { params: Promise<{ callid: string }> };
export async function GET(request: NextRequest, context: Context) {
  const scope = await requireOperationsContext(request); if (!scope.ok) return scope.response;
  const callId = parseActivityUuid((await context.params).callid);
  if (!callId) return NextResponse.json({ error: "callId must be a valid UUID" }, { status: 400 });
  try {
    const result = await pool.query("SELECT * FROM calls WHERE call_id=$1", [callId]);
    if (!result.rowCount) return NextResponse.json({ error: "Call not found" }, { status: 404 });
    const call = result.rows[0];
    if (!canAccessOperationsEntity(scope.context.access, Number(call.company_id), Number(call.project_id))) return NextResponse.json({ error: "You do not have access to this call" }, { status: 403 });
    if (call.recording_status !== "available") return NextResponse.json({ error: `Recording is ${call.recording_status}` }, { status: 409 });
    if (call.recording_id && call.provider_call_id) {
      const access = await providerRequest(`/recordings/${encodeURIComponent(call.recording_id)}/access`, "GET");
      return NextResponse.json({ recording: access });
    }
    if (call.recording_url) return NextResponse.json({ recording: { url: call.recording_url, expires_at: null } });
    return NextResponse.json({ error: "Recording access is unavailable" }, { status: 404 });
  } catch (error) {
    if (error instanceof Error && error.message === "TELEPHONY_NOT_CONFIGURED") return NextResponse.json({ error: "Telephony provider is not configured" }, { status: 503 });
    console.error("Failed to retrieve recording access", error); return NextResponse.json({ error: "Unable to retrieve recording access" }, { status: 502 });
  }
}
