import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { requireTransfer } from "@/lib/transferAccess";
import {
  addTransferHistory,
  copyTransferChecklist,
  getTransfer,
  TRANSFER_COLUMNS,
  validateTransferPayload,
  validateTransferReferences,
} from "@/lib/transfers";

type Context = { params: Promise<{ transferid: string }> };

export async function GET(request: NextRequest, context: Context) {
  const access = await requireTransfer(request, (await context.params).transferid);
  if (!access.ok) return access.response;
  try {
    const result = await pool.query(
      `SELECT ${TRANSFER_COLUMNS}, p.project_name,
        COALESCE(o.opportunity_name, BTRIM(CONCAT_WS(' ',c.first_name,c.last_name))) AS subject_name,
        CASE WHEN recipient.user_id IS NULL THEN NULL ELSE JSONB_BUILD_OBJECT(
          'user_id', recipient.user_id, 'first_name', recipient.first_name,
          'last_name', recipient.last_name, 'email', recipient.email
        ) END AS recipient,
        CASE WHEN recipient_team.team_id IS NULL THEN NULL ELSE JSONB_BUILD_OBJECT(
          'team_id', recipient_team.team_id, 'team_name', recipient_team.name
        ) END AS recipient_team
       FROM transfers tr
       JOIN projects p ON p.project_id=tr.project_id
       LEFT JOIN opportunities o ON o.opportunity_id=tr.opportunity_id
       LEFT JOIN leads l ON l.lead_id=tr.lead_id
       LEFT JOIN contacts c ON c.contact_id=COALESCE(o.contact_id,l.contact_id)
       LEFT JOIN users recipient ON recipient.user_id=tr.to_owner_user_id
       LEFT JOIN teams recipient_team ON recipient_team.team_id=tr.to_team_id
       WHERE tr.transfer_id=$1`,
      [access.transferId],
    );
    return NextResponse.json({ transfer: result.rows[0] });
  } catch (error) {
    console.error("Failed to retrieve transfer", error);
    return NextResponse.json({ error: "Unable to retrieve transfer" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest, context: Context) {
  const access = await requireTransfer(request, (await context.params).transferid);
  if (!access.ok) return access.response;
  if (
    !access.context.access.canViewAllProjects &&
    access.transfer.requested_by !== access.context.userId
  )
    return NextResponse.json(
      { error: "Only the requester or an administrator can edit this transfer" },
      { status: 403 },
    );
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must contain valid JSON" }, { status: 400 });
  }
  const validation = validateTransferPayload(body, true);
  if (!validation.ok)
    return NextResponse.json({ error: "Validation failed", details: validation.errors }, { status: 422 });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const transfer = await getTransfer(client, access.transferId, true);
    if (!transfer) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "Transfer not found" }, { status: 404 });
    }
    if (!["draft", "validated"].includes(String(transfer.status))) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "Only draft or validated transfers can be edited" }, { status: 409 });
    }
    const data = { ...validation.data };
    if (data.to_owner_user_id) data.to_team_id = null;
    else if (data.to_team_id) data.to_owner_user_id = null;
    const merged = {
      to_owner_user_id: data.to_owner_user_id !== undefined ? data.to_owner_user_id : (transfer.to_owner_user_id as string | null),
      to_team_id: data.to_team_id !== undefined ? data.to_team_id : (transfer.to_team_id as string | null),
      checklist_template_id: data.checklist_template_id !== undefined ? data.checklist_template_id : (transfer.checklist_template_id as string | null),
      expires_at: data.expires_at !== undefined ? data.expires_at : (transfer.expires_at as string | null),
    };
    const errors = await validateTransferReferences(
      client,
      Number(transfer.company_id),
      Number(transfer.project_id),
      merged,
    );
    if (errors.length) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "Validation failed", details: errors }, { status: 422 });
    }
    const entries = Object.entries(data).filter(([, value]) => value !== undefined);
    const values = entries.map(([, value]) => value);
    values.push(access.transferId);
    const assignments = entries.map(([field], index) => `${field}=$${index + 1}`);
    const updated = await client.query(
      `UPDATE transfers SET ${assignments.join(", ")}, status='draft',
       validation_errors='[]'::jsonb, validated_at=NULL, validated_by=NULL,
       updated_at=CURRENT_TIMESTAMP WHERE transfer_id=$${values.length} RETURNING *`,
      values,
    );
    if (
      data.checklist_template_id !== undefined &&
      data.checklist_template_id !== transfer.checklist_template_id
    )
      await copyTransferChecklist(client, access.transferId, data.checklist_template_id ?? null);
    await addTransferHistory(client, transfer, "updated", "draft", access.context.userId, { fields: entries.map(([field]) => field) });
    await client.query("COMMIT");
    return NextResponse.json({ message: "Transfer updated", transfer: updated.rows[0] });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    console.error("Failed to update transfer", error);
    return NextResponse.json({ error: "Unable to update transfer" }, { status: 500 });
  } finally {
    client.release();
  }
}
