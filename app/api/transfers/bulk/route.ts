import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import {
  missingRequiredChecklistItems,
  validateBulkTransferPayload,
} from "@/lib/bulkTransfers";
import { prepareBulkTransfer } from "@/lib/bulkTransferService";
import { requireLeadVisibility } from "@/lib/leadVisibility";
import {
  createNotificationsForUsers,
  resolveNotificationRecipients,
} from "@/lib/notifications";
import { canAccessProject } from "@/lib/projectAccess";
import {
  addTransferHistory,
  copyTransferChecklist,
} from "@/lib/transfers";
import { getDatabaseErrorCode } from "@/utils/getDatabaseErrorCode";

export async function POST(request: NextRequest) {
  const scope = await requireLeadVisibility(request, "LEADS_ASSIGN");
  if (!scope.ok) return scope.response;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Request body must contain valid JSON" },
      { status: 400 },
    );
  }
  const validation = validateBulkTransferPayload(body);
  if (!validation.ok)
    return NextResponse.json(
      { error: "Validation failed", details: validation.errors },
      { status: 422 },
    );
  if (!canAccessProject(scope.context.access, validation.data.project_id))
    return NextResponse.json(
      { error: "Invalid or inaccessible project_id" },
      { status: 400 },
    );

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const prepared = await prepareBulkTransfer(
      client,
      validation.data,
      scope.context.leadVisibility,
      true,
    );
    if (prepared.referenceErrors.length) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: "Validation failed", details: prepared.referenceErrors },
        { status: 422 },
      );
    }
    if (!prepared.eligible.length) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        {
          error: "None of the selected leads can be transferred",
          blocked: prepared.blocked,
        },
        { status: 409 },
      );
    }
    const missingChecklistItems = missingRequiredChecklistItems(
      prepared.checklistItems
        .filter((item) => item.is_required)
        .map((item) => item.item_id),
      validation.data.confirmed_checklist_item_ids,
    );
    if (missingChecklistItems.length) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        {
          error: "Confirm every required checklist item before submitting",
          missing_checklist_item_ids: missingChecklistItems,
        },
        { status: 422 },
      );
    }

    const companyId = scope.context.access.company.company_id;
    const batchResult = await client.query(
      `INSERT INTO transfer_batches (
         company_id, project_id, requested_by, to_owner_user_id, to_team_id,
         checklist_template_id, status, reason, notes, expires_at, submitted_at,
         requested_count, created_count, blocked_count, blocked_items
       ) VALUES ($1,$2,$3,$4,$5,$6,'submitted',$7,$8,$9,CURRENT_TIMESTAMP,
         $10,$11,$12,$13::jsonb)
       RETURNING *`,
      [
        companyId,
        validation.data.project_id,
        scope.context.userId,
        validation.data.to_owner_user_id,
        validation.data.to_team_id,
        prepared.templateId,
        validation.data.reason,
        validation.data.notes,
        validation.data.expires_at,
        validation.data.lead_ids.length,
        prepared.eligible.length,
        prepared.blocked.length,
        JSON.stringify(prepared.blocked),
      ],
    );
    const batch = batchResult.rows[0];
    const transfers = [];
    for (const lead of prepared.eligible) {
      const inserted = await client.query(
        `INSERT INTO transfers (
           company_id, project_id, subject_type, lead_id,
           from_owner_user_id, from_team_id, to_owner_user_id, to_team_id,
           checklist_template_id, status, reason, notes, expires_at,
           requested_by, validated_by, validated_at, submitted_at,
           subject_name_snapshot, batch_id
         ) VALUES ($1,$2,'lead',$3,$4,$5,$6,$7,$8,'submitted',$9,$10,$11,
           $12,$12,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,$13,$14)
         RETURNING *`,
        [
          companyId,
          validation.data.project_id,
          lead.lead_id,
          lead.current_owner_user_id,
          lead.current_team_id,
          validation.data.to_owner_user_id,
          validation.data.to_team_id,
          prepared.templateId,
          validation.data.reason,
          validation.data.notes,
          validation.data.expires_at,
          scope.context.userId,
          lead.subject_name,
          batch.batch_id,
        ],
      );
      const transfer = inserted.rows[0];
      await copyTransferChecklist(
        client,
        transfer.transfer_id,
        prepared.templateId,
      );
      if (validation.data.confirmed_checklist_item_ids.length) {
        await client.query(
          `UPDATE transfer_checklist_items SET is_completed=TRUE,
             completed_by=$1, completed_at=CURRENT_TIMESTAMP,
             updated_at=CURRENT_TIMESTAMP
           WHERE transfer_id=$2
             AND template_item_id=ANY($3::uuid[])`,
          [
            scope.context.userId,
            transfer.transfer_id,
            validation.data.confirmed_checklist_item_ids,
          ],
        );
      }
      const metadata = { batch_id: batch.batch_id };
      await addTransferHistory(
        client,
        { ...transfer, status: null },
        "created",
        "draft",
        scope.context.userId,
        metadata,
      );
      await addTransferHistory(
        client,
        { ...transfer, status: "draft" },
        "validated",
        "validated",
        scope.context.userId,
        metadata,
      );
      await addTransferHistory(
        client,
        { ...transfer, status: "validated" },
        "submitted",
        "submitted",
        scope.context.userId,
        metadata,
      );
      transfers.push(transfer);
    }

    const recipients = await resolveNotificationRecipients(client, {
      companyId,
      userIds: [validation.data.to_owner_user_id],
      teamIds: [validation.data.to_team_id],
      excludeUserIds: [scope.context.userId],
    });
    await createNotificationsForUsers(client, recipients, {
      companyId,
      projectId: validation.data.project_id,
      type: "transfer.batch_submitted",
      category: "transfer",
      title: `${prepared.eligible.length} lead transfers awaiting decision`,
      body: `A bulk ownership handoff containing ${prepared.eligible.length} leads was sent to you.`,
      severity: "info",
      entityType: "transfer_batch",
      entityId: batch.batch_id,
      actionUrl: `/transfers?project_id=${validation.data.project_id}&batch_id=${batch.batch_id}`,
      eventKey: `transfer-batch:${batch.batch_id}:submitted`,
      metadata: {
        batch_id: batch.batch_id,
        lead_count: prepared.eligible.length,
        status: "submitted",
      },
      channels: ["in_app", "email"],
    });
    await client.query("COMMIT");
    return NextResponse.json(
      {
        message: `${transfers.length} lead transfers submitted`,
        batch,
        transfers,
        blocked: prepared.blocked,
      },
      { status: 201 },
    );
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    if (getDatabaseErrorCode(error) === "23505")
      return NextResponse.json(
        {
          error:
            "One of the selected leads already has an active transfer. Review the selection and try again.",
        },
        { status: 409 },
      );
    console.error("Failed to create bulk transfer", error);
    return NextResponse.json(
      { error: "Unable to create bulk transfer" },
      { status: 500 },
    );
  } finally {
    client.release();
  }
}
