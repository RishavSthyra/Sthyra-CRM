import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { recordActivity } from "@/lib/activities";
import { createNotification } from "@/lib/notifications";
import { addCallHistory, verifyTelephonyWebhook } from "@/lib/telephony";
import { isObject } from "@/utils/isObject";

export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  if (!process.env.TELEPHONY_WEBHOOK_SECRET) return NextResponse.json({ error: "Telephony webhook is not configured" }, { status: 503 });
  if (!verifyTelephonyWebhook(rawBody, request.headers.get("x-telephony-signature"), request.headers.get("authorization"))) return NextResponse.json({ error: "Invalid webhook signature" }, { status: 401 });
  let body: unknown; try { body = JSON.parse(rawBody); } catch { return NextResponse.json({ error: "Request body must contain valid JSON" }, { status: 400 }); }
  if (!isObject(body) || Array.isArray(body)) return NextResponse.json({ error: "Request body must be a JSON object" }, { status: 422 });
  const provider = String(body.provider ?? process.env.TELEPHONY_PROVIDER ?? "generic");
  const providerCallId = String(body.provider_call_id ?? body.call_id ?? "").trim();
  const from = String(body.from ?? "").trim(); const to = String(body.to ?? "").trim();
  if (!providerCallId || !from || !to) return NextResponse.json({ error: "provider_call_id, from, and to are required" }, { status: 422 });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const number = await client.query(`SELECT * FROM telephony_phone_numbers WHERE provider=$1 AND regexp_replace(phone_number,'[^0-9]','','g')=regexp_replace($2,'[^0-9]','','g') AND is_active=TRUE FOR UPDATE`, [provider, to]);
    if (!number.rowCount) { await client.query("ROLLBACK"); return NextResponse.json({ error: "No active inbound route for this number" }, { status: 404 }); }
    const route = number.rows[0];
    const lead = await client.query(
      `SELECT l.lead_id, l.contact_id, l.project_id, l.current_owner_user_id
       FROM leads l JOIN contacts c ON c.contact_id=l.contact_id JOIN projects p ON p.project_id=l.project_id
       WHERE p.company_id=$1 AND regexp_replace($2,'[^0-9]','','g')=ANY(ARRAY[
         regexp_replace(c.phone_number,'[^0-9]','','g'), regexp_replace(c.alternate_phone_number,'[^0-9]','','g')])
       ORDER BY (l.project_id=$3) DESC, l.updated_at DESC LIMIT 1`, [route.company_id, from, route.project_id],
    );
    const linked = lead.rows[0] ?? null;
    const projectId = Number(route.project_id ?? linked?.project_id);
    if (!projectId) { await client.query("ROLLBACK"); return NextResponse.json({ error: "Inbound number must be assigned to a project" }, { status: 409 }); }
    let userId = route.route_to_user_id ?? linked?.current_owner_user_id ?? null;
    if (!userId && route.route_to_team_id) {
      const available = await client.query(`SELECT tap.user_id FROM telephony_agent_presence tap JOIN users u ON u.user_id=tap.user_id WHERE u.team_id=$1 AND tap.status='available' ORDER BY tap.last_seen_at DESC LIMIT 1`, [route.route_to_team_id]); userId = available.rows[0]?.user_id ?? null;
    }
    const inserted = await client.query(
      `INSERT INTO calls (company_id, project_id, lead_id, contact_id, direction, status, phone_number,
       subject, started_at, initiated_at, owner_user_id, provider, provider_call_id, provider_metadata)
       VALUES ($1,$2,$3,$4,'inbound','ringing',$5,$6,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,$7,$8,$9,$10)
       ON CONFLICT (company_id, provider, provider_call_id) WHERE provider_call_id IS NOT NULL
       DO NOTHING RETURNING *`,
      [route.company_id, projectId, linked?.lead_id ?? null, linked?.contact_id ?? null, from, `Inbound call from ${from}`, userId, provider, providerCallId, body],
    );
    if (!inserted.rowCount) {
      const existing = await client.query("SELECT call_id FROM calls WHERE company_id=$1 AND provider=$2 AND provider_call_id=$3", [route.company_id, provider, providerCallId]);
      await client.query("COMMIT");
      return NextResponse.json({ message: "Inbound call already routed", duplicate: true, call_id: existing.rows[0]?.call_id ?? null });
    }
    const call = inserted.rows[0];
    await addCallHistory(client, call.call_id, "inbound_route", null, "ringing", null, { to, route_id: route.phone_number_id });
    await recordActivity(client, call, "call", "inbound_call", call.subject, null, { metadata: { phone_number: from, status: "ringing" } });
    if (userId) await createNotification(client, { companyId: Number(route.company_id), projectId, userId, type: "telephony.inbound_call", title: "Incoming call", body: linked ? `Incoming call from a linked lead (${from})` : `Incoming call from ${from}`, severity: "info", entityType: "call", entityId: call.call_id, actionUrl: `/activity?tab=calls&call=${call.call_id}` });
    await client.query("COMMIT");
    return NextResponse.json({ call_id: call.call_id, route: { user_id: userId, team_id: route.route_to_team_id, project_id: projectId }, linked_lead_id: linked?.lead_id ?? null });
  } catch (error) { await client.query("ROLLBACK").catch(() => undefined); console.error("Failed to route inbound call", error); return NextResponse.json({ error: "Unable to route inbound call" }, { status: 500 }); }
  finally { client.release(); }
}
