import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import {
  createNotificationsForUsers,
  resolveNotificationRecipients,
} from "@/lib/notifications";
import { canAccessOperationsEntity, requireOperationsContext } from "@/lib/operationsAccess";
import { parseUuid } from "@/lib/operations";
import {
  addTransferHistory,
  applyTransferOwnership,
  getTransferValidationErrors,
  incompleteRequiredChecklistCount,
  syncTransferBatchStatus,
} from "@/lib/transfers";
import { isObject } from "@/utils/isObject";
import { validateText } from "@/utils/validateText";

type Context = {
  params: Promise<{ batchid: string; action: string }>;
};

export async function POST(request: NextRequest, context: Context) {
  const scope = await requireOperationsContext(request);
  if (!scope.ok) return scope.response;
  const { batchid: rawBatchId, action } = await context.params;
  const batchId = parseUuid(rawBatchId);
  if (!batchId)
    return NextResponse.json(
      { error: "batchId must be a valid UUID" },
      { status: 400 },
    );
  if (!['accept', 'reject', 'cancel'].includes(action))
    return NextResponse.json({ error: "Unsupported batch action" }, { status: 404 });

  let body: unknown = {};
  const text = await request.text();
  if (text.trim()) {
    try {
      body = JSON.parse(text);
    } catch {
      return NextResponse.json(
        { error: "Request body must contain valid JSON" },
        { status: 400 },
      );
    }
  }
  if (!isObject(body) || Array.isArray(body))
    return NextResponse.json(
      { error: "Request body must be a JSON object" },
      { status: 400 },
    );
  const errors: string[] = [];
  Object.keys(body)
    .filter((key) => key !== "reason")
    .forEach((key) => errors.push(`Unknown field: ${key}`));
  const reason = validateText(body.reason, "reason", 5000, true, errors);
  if (action === "reject" && !reason)
    errors.push("reason is required when rejecting transfers");
  if (errors.length)
    return NextResponse.json(
      { error: "Validation failed", details: errors },
      { status: 422 },
    );

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const batchResult = await client.query(
      "SELECT * FROM transfer_batches WHERE batch_id=$1 FOR UPDATE",
      [batchId],
    );
    const batch = batchResult.rows[0];
    if (!batch) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "Transfer batch not found" }, { status: 404 });
    }
    if (
      !canAccessOperationsEntity(
        scope.context.access,
        Number(batch.company_id),
        Number(batch.project_id),
      )
    ) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: "You do not have access to this transfer batch" },
        { status: 403 },
      );
    }

    const admin = scope.context.access.canViewAllProjects;
    let teamRecipient = false;
    if (batch.to_team_id) {
      const membership = await client.query(
        `SELECT 1 FROM users WHERE user_id=$1 AND team_id=$2
         AND is_active=TRUE AND deleted_at IS NULL`,
        [scope.context.userId, batch.to_team_id],
      );
      teamRecipient = Boolean(membership.rowCount);
    }
    const recipient =
      batch.to_owner_user_id === scope.context.userId || teamRecipient;
    if (["accept", "reject"].includes(action) && !recipient) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: "Only the transfer recipient can decide this batch" },
        { status: 403 },
      );
    }
    if (action === "cancel" && !admin && batch.requested_by !== scope.context.userId) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: "Only the requester or an administrator can cancel this batch" },
        { status: 403 },
      );
    }

    const transferableStatuses =
      action === "cancel" ? ["draft", "validated", "submitted"] : ["submitted"];
    const transfers = await client.query(
      `SELECT * FROM transfers WHERE batch_id=$1 AND status=ANY($2::varchar[])
       ORDER BY created_at, transfer_id FOR UPDATE`,
      [batchId, transferableStatuses],
    );
    if (!transfers.rowCount) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: "This batch has no transfers awaiting that action" },
        { status: 409 },
      );
    }

    if (action === "accept") {
      const invalid: Array<{ transfer_id: string; errors: string[] }> = [];
      for (const transfer of transfers.rows) {
        const validationErrors = await getTransferValidationErrors(client, transfer);
        const incomplete = await incompleteRequiredChecklistCount(
          client,
          transfer.transfer_id,
        );
        if (incomplete)
          validationErrors.push("Required checklist items must be completed");
        if (validationErrors.length)
          invalid.push({ transfer_id: transfer.transfer_id, errors: validationErrors });
      }
      if (invalid.length) {
        await client.query("ROLLBACK");
        return NextResponse.json(
          { error: "Some transfers are no longer valid", invalid },
          { status: 422 },
        );
      }
    }

    const targetStatus =
      action === "accept" ? "accepted" : action === "reject" ? "rejected" : "cancelled";
    const timeColumn =
      action === "accept" ? "accepted_at" : action === "reject" ? "rejected_at" : "cancelled_at";
    for (const transfer of transfers.rows) {
      if (action === "accept")
        await applyTransferOwnership(client, transfer, scope.context.userId);
      await client.query(
        `UPDATE transfers SET status=$1, ${timeColumn}=CURRENT_TIMESTAMP,
         decided_by=CASE WHEN $1 IN ('accepted','rejected') THEN $2 ELSE decided_by END,
         rejection_reason=CASE WHEN $1='rejected' THEN $3 ELSE rejection_reason END,
         updated_at=CURRENT_TIMESTAMP WHERE transfer_id=$4`,
        [targetStatus, scope.context.userId, reason ?? null, transfer.transfer_id],
      );
      await addTransferHistory(
        client,
        transfer,
        `batch_${action}`,
        targetStatus,
        scope.context.userId,
        { batch_id: batchId, reason: reason ?? null },
      );
    }
    const batchStatus = await syncTransferBatchStatus(client, batchId);
    const recipients = await resolveNotificationRecipients(client, {
      companyId: Number(batch.company_id),
      userIds: [batch.requested_by],
      excludeUserIds: [scope.context.userId],
    });
    await createNotificationsForUsers(client, recipients, {
      companyId: Number(batch.company_id),
      projectId: Number(batch.project_id),
      type: `transfer.batch_${targetStatus}`,
      category: "transfer",
      title: `Bulk transfer ${targetStatus}`,
      body: `${transfers.rowCount} lead transfers were ${targetStatus}.`,
      severity: targetStatus === "accepted" ? "success" : "warning",
      entityType: "transfer_batch",
      entityId: batchId,
      actionUrl: `/transfers?project_id=${batch.project_id}&batch_id=${batchId}`,
      eventKey: `transfer-batch:${batchId}:${targetStatus}`,
      metadata: { batch_id: batchId, status: batchStatus, count: transfers.rowCount },
      channels: ["in_app", "email"],
    });
    await client.query("COMMIT");
    return NextResponse.json({
      message: `${transfers.rowCount} transfers ${targetStatus}`,
      batch_id: batchId,
      status: batchStatus,
      updated_count: transfers.rowCount,
    });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    console.error(`Failed to ${action} transfer batch`, error);
    return NextResponse.json(
      { error: `Unable to ${action} transfer batch` },
      { status: 500 },
    );
  } finally {
    client.release();
  }
}
