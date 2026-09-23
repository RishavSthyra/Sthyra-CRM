import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { parseUuid } from "@/lib/operations";
import {
  canAccessOperationsEntity,
  requireOperationsContext,
} from "@/lib/operationsAccess";
import { isObject } from "@/utils/isObject";
import { validateText } from "@/utils/validateText";

export async function changeSlaInstanceState(
  request: NextRequest,
  rawSlaId: string,
  action: "escalated" | "waived",
) {
  const scope = await requireOperationsContext(request);
  if (!scope.ok) return scope.response;
  if (!scope.context.access.canViewAllProjects) {
    return NextResponse.json(
      { error: "Administrator access is required" },
      { status: 403 },
    );
  }
  const slaId = parseUuid(rawSlaId);
  if (!slaId) {
    return NextResponse.json(
      { error: "slaId must be a valid UUID" },
      { status: 400 },
    );
  }

  let body: unknown = {};
  try {
    const text = await request.text();
    body = text ? JSON.parse(text) : {};
  } catch {
    return NextResponse.json(
      { error: "Request body must contain valid JSON" },
      { status: 400 },
    );
  }
  if (!isObject(body) || Array.isArray(body)) {
    return NextResponse.json(
      { error: "Request body must be a JSON object" },
      { status: 422 },
    );
  }
  const errors: string[] = [];
  const allowed = new Set(action === "waived" ? ["reason"] : ["notes"]);
  for (const field of Object.keys(body)) {
    if (!allowed.has(field)) errors.push(`Unknown field: ${field}`);
  }
  const text = validateText(
    action === "waived" ? body.reason : body.notes,
    action === "waived" ? "reason" : "notes",
    5000,
    action !== "waived",
    errors,
  );
  if (action === "waived" && !text) errors.push("reason is required");
  if (errors.length) {
    return NextResponse.json(
      { error: "Validation failed", details: errors },
      { status: 422 },
    );
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const currentResult = await client.query(
      "SELECT * FROM sla_instances WHERE sla_id=$1 FOR UPDATE",
      [slaId],
    );
    if (!currentResult.rowCount) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: "SLA instance not found" },
        { status: 404 },
      );
    }
    const current = currentResult.rows[0];
    if (
      !canAccessOperationsEntity(
        scope.context.access,
        Number(current.company_id),
        Number(current.project_id),
      )
    ) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: "You do not have access to this SLA instance" },
        { status: 403 },
      );
    }
    const allowedStatuses =
      action === "escalated"
        ? ["running", "breached"]
        : ["running", "breached", "escalated"];
    if (!allowedStatuses.includes(current.status)) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        {
          error: `Cannot ${action === "waived" ? "waive" : "escalate"} an SLA with status ${current.status}`,
        },
        { status: 409 },
      );
    }

    const result =
      action === "escalated"
        ? await client.query(
            `UPDATE sla_instances
             SET status='escalated', escalated_at=CURRENT_TIMESTAMP,
                 escalated_by=$2, escalation_notes=$3,
                 updated_at=CURRENT_TIMESTAMP
             WHERE sla_id=$1 RETURNING *`,
            [slaId, scope.context.userId, text ?? null],
          )
        : await client.query(
            `UPDATE sla_instances
             SET status='waived', waived_at=CURRENT_TIMESTAMP,
                 waived_by=$2, waiver_reason=$3,
                 updated_at=CURRENT_TIMESTAMP
             WHERE sla_id=$1 RETURNING *`,
            [slaId, scope.context.userId, text],
          );
    await client.query(
      `INSERT INTO sla_instance_history
       (sla_id, action, from_status, to_status, notes, performed_by)
       VALUES ($1,$2,$3,$2,$4,$5)`,
      [slaId, action, current.status, text ?? null, scope.context.userId],
    );
    await client.query("COMMIT");
    return NextResponse.json({
      message: `SLA instance ${action}`,
      sla: result.rows[0],
    });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    console.error(`Failed to mark SLA instance ${action}`, error);
    return NextResponse.json(
      { error: `Unable to mark SLA instance ${action}` },
      { status: 500 },
    );
  } finally {
    client.release();
  }
}
