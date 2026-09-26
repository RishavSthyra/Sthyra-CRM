import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { parseUuid } from "@/lib/operations";
import {
  canAccessOperationsEntity,
  requireOperationsContext,
} from "@/lib/operationsAccess";
import {
  addTransferHistory,
  applyTransferOwnership,
  getTransfer,
  getTransferValidationErrors,
  incompleteRequiredChecklistCount,
  validateTransferReferences,
} from "@/lib/transfers";
import { isObject } from "@/utils/isObject";
import { validateText } from "@/utils/validateText";

export type TransferAction =
  | "validate"
  | "submit"
  | "accept"
  | "reject"
  | "cancel"
  | "expire"
  | "force_assign";

async function optionalBody(request: NextRequest) {
  const text = await request.text();
  if (!text.trim()) return {};
  try {
    const parsed = JSON.parse(text);
    return isObject(parsed) && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

async function userBelongsToTeam(userId: string, teamId: string) {
  const result = await pool.query(
    "SELECT 1 FROM users WHERE user_id=$1 AND team_id=$2 AND is_active=TRUE AND deleted_at IS NULL",
    [userId, teamId],
  );
  return Boolean(result.rowCount);
}

export async function handleTransferAction(
  request: NextRequest,
  rawTransferId: string,
  action: TransferAction,
) {
  const scope = await requireOperationsContext(request);
  if (!scope.ok) return scope.response;
  const transferId = parseUuid(rawTransferId);
  if (!transferId)
    return NextResponse.json({ error: "transferId must be a valid UUID" }, { status: 400 });
  const body = await optionalBody(request);
  if (!body)
    return NextResponse.json({ error: "Request body must contain a valid JSON object" }, { status: 400 });
  const errors: string[] = [];
  const unknown = Object.keys(body).filter((key) => key !== "reason");
  unknown.forEach((key) => errors.push(`Unknown field: ${key}`));
  const reason = validateText(body.reason, "reason", 5000, true, errors);
  if (action === "reject" && !reason) errors.push("reason is required when rejecting a transfer");
  if (errors.length)
    return NextResponse.json({ error: "Validation failed", details: errors }, { status: 422 });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const transfer = await getTransfer(client, transferId, true);
    if (!transfer) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "Transfer not found" }, { status: 404 });
    }
    if (!canAccessOperationsEntity(scope.context.access, Number(transfer.company_id), Number(transfer.project_id))) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "You do not have access to this transfer" }, { status: 403 });
    }
    const admin = scope.context.access.canViewAllProjects;
    const requester = transfer.requested_by === scope.context.userId;
    const targetUser = transfer.to_owner_user_id === scope.context.userId;
    const targetTeam = transfer.to_team_id
      ? await userBelongsToTeam(scope.context.userId, transfer.to_team_id as string)
      : false;
    const recipient = targetUser || targetTeam;
    const currentStatus = String(transfer.status);

    if (action === "validate") {
      if (!["draft", "validated"].includes(currentStatus)) {
        await client.query("ROLLBACK");
        return NextResponse.json({ error: `Cannot validate a ${currentStatus} transfer` }, { status: 409 });
      }
      if (!requester && !admin) {
        await client.query("ROLLBACK");
        return NextResponse.json({ error: "Only the requester or an administrator can validate this transfer" }, { status: 403 });
      }
      const validationErrors = await getTransferValidationErrors(client, transfer);
      if (validationErrors.length) {
        await client.query(
          `UPDATE transfers SET status='draft', validation_errors=$1::jsonb,
           validated_at=NULL, validated_by=NULL, updated_at=CURRENT_TIMESTAMP
           WHERE transfer_id=$2`,
          [JSON.stringify(validationErrors), transferId],
        );
        await client.query("COMMIT");
        return NextResponse.json(
          { error: "Transfer validation failed", details: validationErrors, valid: false },
          { status: 422 },
        );
      }
      const updated = await client.query(
        `UPDATE transfers SET status='validated', validation_errors='[]'::jsonb,
         validated_at=CURRENT_TIMESTAMP, validated_by=$1,
         updated_at=CURRENT_TIMESTAMP WHERE transfer_id=$2 RETURNING *`,
        [scope.context.userId, transferId],
      );
      await addTransferHistory(client, transfer, "validated", "validated", scope.context.userId);
      await client.query("COMMIT");
      return NextResponse.json({ message: "Transfer is valid", valid: true, transfer: updated.rows[0] });
    }

    const allowed: Record<Exclude<TransferAction, "validate">, string[]> = {
      submit: ["draft", "validated"],
      accept: ["submitted"],
      reject: ["submitted"],
      cancel: ["draft", "validated", "submitted"],
      expire: ["draft", "validated", "submitted"],
      force_assign: ["draft", "validated", "submitted"],
    };
    if (!allowed[action].includes(currentStatus)) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: `Cannot ${action.replaceAll("_", " ")} a ${currentStatus} transfer` }, { status: 409 });
    }

    if (action === "submit" && !requester && !admin) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "Only the requester or an administrator can submit this transfer" }, { status: 403 });
    }
    if (["accept", "reject"].includes(action) && !recipient && !admin) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "Only the recipient or an administrator can decide this transfer" }, { status: 403 });
    }
    if (action === "cancel" && !requester && !admin) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "Only the requester or an administrator can cancel this transfer" }, { status: 403 });
    }
    if (["expire", "force_assign"].includes(action) && !admin) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "Administrator access is required" }, { status: 403 });
    }
    if (
      action === "expire" &&
      transfer.expires_at &&
      new Date(transfer.expires_at as string | Date).getTime() > Date.now()
    ) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "Transfer has not reached its expiry time" }, { status: 409 });
    }

    if (["submit", "accept"].includes(action)) {
      const validationErrors = await getTransferValidationErrors(client, transfer);
      if (validationErrors.length) {
        await client.query("ROLLBACK");
        return NextResponse.json({ error: "Transfer validation failed", details: validationErrors }, { status: 422 });
      }
      const incomplete = await incompleteRequiredChecklistCount(client, transferId);
      if (incomplete > 0) {
        await client.query("ROLLBACK");
        return NextResponse.json(
          { error: "Required checklist items must be completed", incomplete_required_items: incomplete },
          { status: 409 },
        );
      }
    }
    if (action === "force_assign") {
      const referenceErrors = await validateTransferReferences(
        client,
        Number(transfer.company_id),
        Number(transfer.project_id),
        {
          to_owner_user_id:
            (transfer.to_owner_user_id as string | null) ?? null,
          to_team_id: (transfer.to_team_id as string | null) ?? null,
        },
      );
      if (referenceErrors.length) {
        await client.query("ROLLBACK");
        return NextResponse.json(
          { error: "Transfer recipient is no longer eligible", details: referenceErrors },
          { status: 422 },
        );
      }
    }

    const targetStatus =
      action === "force_assign"
        ? "force_assigned"
        : action === "submit"
          ? "submitted"
          : action === "accept"
            ? "accepted"
            : action === "reject"
              ? "rejected"
              : action === "cancel"
                ? "cancelled"
                : "expired";
    if (action === "accept" || action === "force_assign")
      await applyTransferOwnership(client, transfer, scope.context.userId);
    const timeColumn =
      action === "force_assign"
        ? "force_assigned_at"
        : action === "submit"
          ? "submitted_at"
          : action === "cancel"
            ? "cancelled_at"
            : action === "accept"
              ? "accepted_at"
              : action === "reject"
                ? "rejected_at"
                : "expired_at";
    const updated = await client.query(
      `UPDATE transfers SET status=$1, ${timeColumn}=CURRENT_TIMESTAMP,
       decided_by=CASE WHEN $1 IN ('accepted','rejected','force_assigned') THEN $2 ELSE decided_by END,
       rejection_reason=CASE WHEN $1='rejected' THEN $3 ELSE rejection_reason END,
       updated_at=CURRENT_TIMESTAMP WHERE transfer_id=$4 RETURNING *`,
      [targetStatus, scope.context.userId, reason ?? null, transferId],
    );
    await addTransferHistory(
      client,
      transfer,
      action,
      targetStatus,
      scope.context.userId,
      { reason: reason ?? null },
    );
    await client.query("COMMIT");
    return NextResponse.json({
      message: `Transfer ${targetStatus.replaceAll("_", " ")}`,
      transfer: updated.rows[0],
    });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    console.error(`Failed to ${action} transfer`, error);
    return NextResponse.json({ error: `Unable to ${action.replaceAll("_", " ")} transfer` }, { status: 500 });
  } finally {
    client.release();
  }
}
