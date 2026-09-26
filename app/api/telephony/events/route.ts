import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { isUuid } from "@/lib/permissions";
import { addCallHistory, mapProviderStatus, verifyTelephonyWebhook } from "@/lib/telephony";
import { isObject } from "@/utils/isObject";

export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  if (!process.env.TELEPHONY_WEBHOOK_SECRET) return NextResponse.json({ error: "Telephony webhook is not configured" }, { status: 503 });
  if (!verifyTelephonyWebhook(rawBody, request.headers.get("x-telephony-signature"), request.headers.get("authorization"))) return NextResponse.json({ error: "Invalid webhook signature" }, { status: 401 });
  let body: unknown; try { body = JSON.parse(rawBody); } catch { return NextResponse.json({ error: "Request body must contain valid JSON" }, { status: 400 }); }
  if (!isObject(body) || Array.isArray(body)) return NextResponse.json({ error: "Request body must be a JSON object" }, { status: 422 });
  const provider = String(body.provider ?? process.env.TELEPHONY_PROVIDER ?? "generic").trim();
  const eventId = String(body.event_id ?? body.id ?? "").trim();
  const eventType = String(body.type ?? body.event_type ?? "").trim();
  const providerCallId = body.provider_call_id ?? body.call_id;
  if (!provider || !eventId || !eventType) return NextResponse.json({ error: "provider, event_id, and type are required" }, { status: 422 });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const inserted = await client.query(
      `INSERT INTO telephony_events (provider, provider_event_id, provider_call_id, event_type, payload, occurred_at)
       VALUES ($1,$2,$3,$4,$5,COALESCE($6::timestamptz,CURRENT_TIMESTAMP))
       ON CONFLICT (provider, provider_event_id) DO NOTHING RETURNING telephony_event_id`,
      [provider, eventId, providerCallId ? String(providerCallId) : null, eventType, body, typeof body.occurred_at === "string" && !Number.isNaN(Date.parse(body.occurred_at)) ? body.occurred_at : null],
    );
    if (!inserted.rowCount) { await client.query("COMMIT"); return NextResponse.json({ message: "Event already processed", duplicate: true }); }
    let call: Record<string, unknown> | null = null;
    if (isUuid(body.crm_call_id)) {
      const found = await client.query("SELECT * FROM calls WHERE call_id=$1 FOR UPDATE", [String(body.crm_call_id).toLowerCase()]); call = found.rows[0] ?? null;
    } else if (providerCallId) {
      const found = await client.query("SELECT * FROM calls WHERE provider=$1 AND provider_call_id=$2 FOR UPDATE", [provider, String(providerCallId)]); call = found.rows[0] ?? null;
    }
    if (call) {
      const nextStatus = mapProviderStatus(body.status ?? eventType.replace(/^call\./, ""));
      const recording = isObject(body.recording) ? body.recording : {};
      const assignments = ["provider_metadata=provider_metadata || $1::jsonb", "updated_at=CURRENT_TIMESTAMP"];
      const values: unknown[] = [JSON.stringify({ last_event: body })];
      if (nextStatus) { values.push(nextStatus); assignments.push(`status=$${values.length}`); }
      if (nextStatus === "answered" || nextStatus === "in_progress") assignments.push("answered_at=COALESCE(answered_at,CURRENT_TIMESTAMP)");
      if (nextStatus && ["missed", "completed", "failed", "busy", "no_answer", "cancelled"].includes(nextStatus)) assignments.push("ended_at=COALESCE(ended_at,CURRENT_TIMESTAMP)", "duration_seconds=GREATEST(0,EXTRACT(EPOCH FROM (COALESCE(ended_at,CURRENT_TIMESTAMP)-COALESCE(answered_at,started_at)))::integer)", "on_hold=FALSE", "muted=FALSE");
      if (recording.id) { values.push(String(recording.id)); assignments.push(`recording_id=$${values.length}`); }
      if (recording.url) { values.push(String(recording.url)); assignments.push(`recording_url=$${values.length}`); }
      if (recording.status) { const status = ["none", "processing", "available", "failed"].includes(String(recording.status)) ? String(recording.status) : null; if (status) { values.push(status); assignments.push(`recording_status=$${values.length}`); } }
      values.push(call.call_id);
      await client.query(`UPDATE calls SET ${assignments.join(", ")} WHERE call_id=$${values.length}`, values);
      if (nextStatus && nextStatus !== call.status) await addCallHistory(client, String(call.call_id), `provider.${eventType}`, String(call.status), nextStatus, null, { provider_event_id: eventId });
      await client.query("UPDATE telephony_events SET call_id=$1, processed_at=CURRENT_TIMESTAMP WHERE telephony_event_id=$2", [call.call_id, inserted.rows[0].telephony_event_id]);
    } else {
      await client.query("UPDATE telephony_events SET processed_at=CURRENT_TIMESTAMP WHERE telephony_event_id=$1", [inserted.rows[0].telephony_event_id]);
    }
    if (isObject(body.agent) && isUuid(body.agent.user_id) && Number.isSafeInteger(body.agent.company_id)) {
      const presence = ["offline", "available", "busy", "on_call", "away"].includes(String(body.agent.status)) ? String(body.agent.status) : "offline";
      await client.query(
        `INSERT INTO telephony_agent_presence (user_id, company_id, project_id, provider, provider_agent_id, status, current_call_id, last_seen_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
         ON CONFLICT (user_id) DO UPDATE SET project_id=EXCLUDED.project_id, provider=EXCLUDED.provider,
         provider_agent_id=EXCLUDED.provider_agent_id, status=EXCLUDED.status, current_call_id=EXCLUDED.current_call_id,
         last_seen_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP`,
        [String(body.agent.user_id).toLowerCase(), Number(body.agent.company_id), Number.isSafeInteger(body.agent.project_id) ? Number(body.agent.project_id) : null, provider, body.agent.provider_agent_id ? String(body.agent.provider_agent_id) : null, presence, call?.call_id ?? null],
      );
    }
    await client.query("COMMIT");
    return NextResponse.json({ message: "Telephony event processed", call_id: call?.call_id ?? null });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined); console.error("Failed to process telephony event", error);
    return NextResponse.json({ error: "Unable to process telephony event" }, { status: 500 });
  } finally { client.release(); }
}
