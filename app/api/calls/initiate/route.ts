import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { recordActivity } from "@/lib/activities";
import { resolveCommunicationContact } from "@/lib/communications";
import { requireOperationsContext } from "@/lib/operationsAccess";
import { canAccessProject } from "@/lib/projectAccess";
import { addCallHistory, providerRequest, validateInitiateCall } from "@/lib/telephony";

export async function POST(request: NextRequest) {
  const scope = await requireOperationsContext(request); if (!scope.ok) return scope.response;
  let body: unknown; try { body = await request.json(); } catch { return NextResponse.json({ error: "Request body must contain valid JSON" }, { status: 400 }); }
  const validation = validateInitiateCall(body);
  if (!validation.ok) return NextResponse.json({ error: "Validation failed", details: validation.errors }, { status: 422 });
  if (!canAccessProject(scope.context.access, validation.data.project_id)) return NextResponse.json({ error: "You do not have access to this project" }, { status: 403 });
  const client = await pool.connect(); let call: Record<string, unknown> | null = null;
  try {
    await client.query("BEGIN");
    const contactId = await resolveCommunicationContact(client, scope.context.access.company.company_id, validation.data.project_id, validation.data.lead_id, validation.data.contact_id);
    let phone = validation.data.phone_number;
    if (!phone && contactId) {
      const contact = await client.query("SELECT phone_number FROM contacts WHERE contact_id=$1", [contactId]); phone = contact.rows[0]?.phone_number;
    }
    if (!phone) { await client.query("ROLLBACK"); return NextResponse.json({ error: "The linked contact has no phone number" }, { status: 422 }); }
    const inserted = await client.query(
      `INSERT INTO calls (company_id, project_id, lead_id, contact_id, direction, status, phone_number,
       subject, started_at, initiated_at, owner_user_id, created_by, updated_by, provider)
       VALUES ($1,$2,$3,$4,'outbound','initiating',$5,$6,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,$7,$7,$7,$8) RETURNING *`,
      [scope.context.access.company.company_id, validation.data.project_id, validation.data.lead_id ?? null, contactId, phone, validation.data.subject, scope.context.userId, process.env.TELEPHONY_PROVIDER ?? "generic"],
    );
    call = inserted.rows[0];
    await addCallHistory(client, String(call!.call_id), "initiate", null, "initiating", scope.context.userId);
    await client.query("COMMIT");
    const provider = await providerRequest("/calls", "POST", { external_id: call!.call_id, to: phone, project_id: validation.data.project_id, user_id: scope.context.userId });
    const providerId = String(provider.id ?? provider.call_id ?? call!.call_id);
    const updated = await pool.query(`UPDATE calls SET provider_call_id=$1, status='queued', provider_metadata=$2, updated_at=CURRENT_TIMESTAMP WHERE call_id=$3 RETURNING *`, [providerId, provider, call!.call_id]);
    call = updated.rows[0];
    await addCallHistory(pool, String(call!.call_id), "provider_accepted", "initiating", "queued", scope.context.userId, { provider_call_id: providerId });
    await recordActivity(pool, call!, "call", "call_initiated", `Outbound call: ${call!.subject}`, scope.context.userId, { metadata: { phone_number: phone, status: "queued" } });
    return NextResponse.json({ message: "Call initiated", call }, { status: 201 });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    if (call?.call_id) await pool.query(`UPDATE calls SET status='failed', ended_at=CURRENT_TIMESTAMP, provider_metadata=provider_metadata || $2::jsonb, updated_at=CURRENT_TIMESTAMP WHERE call_id=$1`, [call.call_id, JSON.stringify({ initiation_error: error instanceof Error ? error.message : "unknown" })]).catch(() => undefined);
    if (error instanceof Error && error.message === "TELEPHONY_NOT_CONFIGURED") return NextResponse.json({ error: "Telephony provider is not configured" }, { status: 503 });
    const message = error instanceof Error ? error.message : "Unable to initiate call";
    if (message.includes("lead_id") || message.includes("contact_id")) return NextResponse.json({ error: message }, { status: 422 });
    console.error("Failed to initiate call", error); return NextResponse.json({ error: "Unable to initiate call" }, { status: 502 });
  } finally { client.release(); }
}
