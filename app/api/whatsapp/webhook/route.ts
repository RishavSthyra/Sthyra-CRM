import { NextRequest, NextResponse } from "next/server";
import { adminPool } from "@/lib/db";
import { recordActivity } from "@/lib/activities";
import { normalizeWhatsAppPhone, verifyMetaWebhookSignature } from "@/lib/whatsapp";

export async function GET(request: NextRequest) {
  const mode = request.nextUrl.searchParams.get("hub.mode");
  const token = request.nextUrl.searchParams.get("hub.verify_token");
  const challenge = request.nextUrl.searchParams.get("hub.challenge");
  if (mode === "subscribe" && challenge && token === process.env.META_WHATSAPP_WEBHOOK_VERIFY_TOKEN) {
    return new NextResponse(challenge, { status: 200, headers: { "Content-Type": "text/plain" } });
  }
  return NextResponse.json({ error: "Webhook verification failed" }, { status: 403 });
}
function messageBody(message: Record<string, unknown>): string | null {
  const type = String(message.type ?? "unknown");
  const value = message[type];
  if (!value || typeof value !== "object") return null;
  const payload = value as Record<string, unknown>;
  if (typeof payload.body === "string") return payload.body.slice(0, 4096);
  if (typeof payload.caption === "string") return payload.caption.slice(0, 4096);
  if (type === "button" && typeof payload.text === "string") return payload.text.slice(0, 4096);
  if (type === "interactive" && payload.button_reply && typeof payload.button_reply === "object") {
    return String((payload.button_reply as Record<string, unknown>).title ?? "Interactive reply").slice(0, 4096);
  }
  return null;
}

async function handleInbound(connection: Record<string, unknown>, message: Record<string, unknown>) {
  const phone = normalizeWhatsAppPhone(message.from);
  const providerId = typeof message.id === "string" ? message.id : null;
  if (!phone || !providerId) return;
  const linked = await adminPool.query(
    `SELECT contact.contact_id, lead.lead_id, lead.project_id
     FROM contacts contact
     JOIN leads lead ON lead.contact_id=contact.contact_id
     JOIN projects project ON project.project_id=lead.project_id
     WHERE project.company_id=$1
       AND (
         REGEXP_REPLACE(COALESCE(contact.phone_number,''),'[^0-9]','','g')=$2
         OR (
           LENGTH(REGEXP_REPLACE(COALESCE(contact.phone_number,''),'[^0-9]','','g')) >= 10
           AND RIGHT(REGEXP_REPLACE(contact.phone_number,'[^0-9]','','g'),10)=RIGHT($2,10)
         )
       )
     ORDER BY (lead.project_id=$3) DESC, lead.created_at DESC LIMIT 1`,
    [connection.company_id, phone, connection.project_id],
  );
  const relation = linked.rows[0] ?? {};
  const timestamp = Number(message.timestamp);
  const receivedAt = Number.isFinite(timestamp) && timestamp > 0
    ? new Date(timestamp * 1000).toISOString()
    : new Date().toISOString();
  const type = ["text", "template", "image", "document", "audio", "video", "location", "contacts", "interactive"].includes(String(message.type))
    ? String(message.type)
    : "unknown";
  const inserted = await adminPool.query(
    `INSERT INTO whatsapp_messages (
       whatsapp_connection_id, company_id, project_id, lead_id, contact_id,
       direction, message_type, status, recipient_phone, body,
       provider_message_id, provider_payload, received_at
     ) VALUES ($1,$2,$3,$4,$5,'inbound',$6,'received',$7,$8,$9,$10::jsonb,$11)
     ON CONFLICT (whatsapp_connection_id,provider_message_id) DO NOTHING
     RETURNING *`,
    [
      connection.whatsapp_connection_id, connection.company_id,
      relation.project_id ?? connection.project_id, relation.lead_id ?? null,
      relation.contact_id ?? null, type, phone, messageBody(message), providerId,
      JSON.stringify(message), receivedAt,
    ],
  );
  if (inserted.rowCount) {
    await recordActivity(
      adminPool, inserted.rows[0], "whatsapp", "whatsapp_message_received",
      "WhatsApp message received", null,
      { description: inserted.rows[0].body, occurredAt: receivedAt, metadata: { provider_message_id: providerId, message_type: type } },
    );
  }
}

async function handleStatus(connection: Record<string, unknown>, status: Record<string, unknown>) {
  const providerId = typeof status.id === "string" ? status.id : null;
  const state = typeof status.status === "string" ? status.status : "";
  if (!providerId || !["sent", "delivered", "read", "failed"].includes(state)) return;
  const timestamp = Number(status.timestamp);
  const at = Number.isFinite(timestamp) && timestamp > 0 ? new Date(timestamp * 1000).toISOString() : new Date().toISOString();
  const errors = Array.isArray(status.errors) ? status.errors : [];
  const firstError = errors[0] && typeof errors[0] === "object" ? errors[0] as Record<string, unknown> : null;
  const conversation = status.conversation && typeof status.conversation === "object"
    ? status.conversation as Record<string, unknown>
    : null;
  await adminPool.query(
    `UPDATE whatsapp_messages SET status=$3,
       sent_at=CASE WHEN $3='sent' THEN COALESCE(sent_at,$4) ELSE sent_at END,
       delivered_at=CASE WHEN $3='delivered' THEN COALESCE(delivered_at,$4) ELSE delivered_at END,
       read_at=CASE WHEN $3='read' THEN COALESCE(read_at,$4) ELSE read_at END,
       failed_at=CASE WHEN $3='failed' THEN COALESCE(failed_at,$4) ELSE failed_at END,
       provider_conversation_id=COALESCE($5,provider_conversation_id),
       error_code=$6,error_message=$7,provider_payload=provider_payload || $8::jsonb,
       updated_at=CURRENT_TIMESTAMP
     WHERE whatsapp_connection_id=$1 AND provider_message_id=$2`,
    [
      connection.whatsapp_connection_id, providerId, state, at,
      conversation?.id ?? null, firstError?.code ? String(firstError.code) : null,
      firstError?.title ?? firstError?.message ?? null, JSON.stringify({ latest_status: status }),
    ],
  );
}

export async function POST(request: NextRequest) {
  const raw = await request.text();
  if (!verifyMetaWebhookSignature(raw, request.headers.get("x-hub-signature-256"), process.env.META_APP_SECRET)) {
    return NextResponse.json({ error: "Invalid webhook signature" }, { status: 401 });
  }
  let payload: Record<string, unknown>;
  try { payload = JSON.parse(raw) as Record<string, unknown>; }
  catch { return NextResponse.json({ error: "Invalid payload" }, { status: 400 }); }
  try {
    for (const entryValue of Array.isArray(payload.entry) ? payload.entry : []) {
      if (!entryValue || typeof entryValue !== "object") continue;
      const entry = entryValue as Record<string, unknown>;
      for (const changeValue of Array.isArray(entry.changes) ? entry.changes : []) {
        if (!changeValue || typeof changeValue !== "object") continue;
        const value = (changeValue as Record<string, unknown>).value;
        if (!value || typeof value !== "object") continue;
        const event = value as Record<string, unknown>;
        const metadata = event.metadata && typeof event.metadata === "object" ? event.metadata as Record<string, unknown> : {};
        const phoneNumberId = typeof metadata.phone_number_id === "string" ? metadata.phone_number_id : "";
        if (!phoneNumberId) continue;
        const found = await adminPool.query(
          "SELECT * FROM whatsapp_connections WHERE phone_number_id=$1 AND status='connected' LIMIT 1",
          [phoneNumberId],
        );
        if (!found.rowCount) continue;
        const connection = found.rows[0];
        for (const message of Array.isArray(event.messages) ? event.messages : []) {
          if (message && typeof message === "object") await handleInbound(connection, message as Record<string, unknown>);
        }
        for (const status of Array.isArray(event.statuses) ? event.statuses : []) {
          if (status && typeof status === "object") await handleStatus(connection, status as Record<string, unknown>);
        }
        await adminPool.query(
          "UPDATE whatsapp_connections SET last_webhook_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE whatsapp_connection_id=$1",
          [connection.whatsapp_connection_id],
        );
      }
    }
  } catch (error) {
    console.error("Unable to process Meta WhatsApp webhook", error);
    return NextResponse.json({ received: true }, { status: 200 });
  }
  return NextResponse.json({ received: true });
}
