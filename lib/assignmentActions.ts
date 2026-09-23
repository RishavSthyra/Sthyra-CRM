import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import {
  applyLeadOwnership,
  createAssignment,
  getLeadContext,
  OperationsConflictError,
  OperationsReferenceError,
} from "@/lib/assignmentService";
import {
  addAssignmentHistory,
  parseUuid,
  validateAssignmentPayload,
} from "@/lib/operations";
import {
  canAccessOperationsEntity,
  requireOperationsContext,
} from "@/lib/operationsAccess";
import { isObject } from "@/utils/isObject";
import { validateText } from "@/utils/validateText";

type AssignmentAction = "accept" | "reject" | "release";

async function optionalBody(request: NextRequest): Promise<unknown> {
  const text = await request.text();
  if (!text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export async function handleAssignmentAction(
  request: NextRequest,
  rawAssignmentId: string,
  action: AssignmentAction,
) {
  const scope = await requireOperationsContext(request);
  if (!scope.ok) return scope.response;
  const assignmentId = parseUuid(rawAssignmentId);
  if (!assignmentId)
    return NextResponse.json(
      { error: "assignmentId must be a valid UUID" },
      { status: 400 },
    );
  const body = await optionalBody(request);
  if (!isObject(body) || Array.isArray(body))
    return NextResponse.json(
      { error: "Request body must contain valid JSON object" },
      { status: 400 },
    );
  const errors: string[] = [];
  const reason = validateText(body.reason, "reason", 2000, true, errors);
  const unknown = Object.keys(body).filter((key) => key !== "reason");
  unknown.forEach((key) => errors.push(`Unknown field: ${key}`));
  if ((action === "reject" || action === "release") && !reason)
    errors.push("reason is required");
  if (errors.length)
    return NextResponse.json(
      { error: "Validation failed", details: errors },
      { status: 422 },
    );

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      "SELECT * FROM assignments WHERE assignment_id=$1 FOR UPDATE",
      [assignmentId],
    );
    if (!result.rowCount) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: "Assignment not found" },
        { status: 404 },
      );
    }
    const assignment = result.rows[0];
    if (
      !canAccessOperationsEntity(
        scope.context.access,
        Number(assignment.company_id),
        Number(assignment.project_id),
      )
    ) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: "You do not have access to this assignment" },
        { status: 403 },
      );
    }
    const canAct =
      scope.context.access.canViewAllProjects ||
      !assignment.assigned_to_user_id ||
      assignment.assigned_to_user_id === scope.context.userId;
    if (!canAct) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        {
          error:
            "Only the assignee or an administrator can perform this action",
        },
        { status: 403 },
      );
    }
    const allowedStatuses: Record<AssignmentAction, string[]> = {
      accept: ["pending"],
      reject: ["pending"],
      release: ["pending", "accepted"],
    };
    if (!allowedStatuses[action].includes(assignment.status)) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        {
          error: `Cannot ${action} an assignment with status ${assignment.status}`,
        },
        { status: 409 },
      );
    }
    const targetStatus =
      action === "accept"
        ? "accepted"
        : action === "reject"
          ? "rejected"
          : "released";
    const timeColumn =
      action === "accept"
        ? "accepted_at"
        : action === "reject"
          ? "rejected_at"
          : "released_at";
    const reasonColumn =
      action === "reject"
        ? "rejection_reason"
        : action === "release"
          ? "release_reason"
          : null;
    const values: unknown[] = [targetStatus, assignmentId];
    let reasonAssignment = "";
    if (reasonColumn) {
      values.push(reason);
      reasonAssignment = `, ${reasonColumn}=$${values.length}`;
    }
    const updated = await client.query(
      `UPDATE assignments SET status=$1, ${timeColumn}=CURRENT_TIMESTAMP${reasonAssignment}, updated_at=CURRENT_TIMESTAMP
       WHERE assignment_id=$2 RETURNING *`,
      values,
    );
    await addAssignmentHistory(
      client,
      assignment,
      action,
      targetStatus,
      scope.context.userId,
      { reason },
    );
    const lead = await getLeadContext(client, assignment.lead_id, true);
    if (lead && action === "accept") {
      await applyLeadOwnership(
        client,
        lead,
        assignment.assigned_to_user_id,
        assignment.assigned_to_team_id,
        scope.context.userId,
        lead.current_owner_user_id || lead.current_team_id
          ? "transferred"
          : "assigned",
      );
      const slaRows = await client.query(
        `UPDATE sla_instances
         SET responded_at=COALESCE(responded_at,CURRENT_TIMESTAMP),
             status=CASE WHEN resolution_due_at IS NULL THEN 'met' ELSE status END,
             updated_at=CURRENT_TIMESTAMP
         WHERE assignment_id=$1 AND status='running' RETURNING sla_id, status`,
        [assignmentId],
      );
      for (const sla of slaRows.rows)
        await client.query(
          `INSERT INTO sla_instance_history (sla_id, action, from_status, to_status, performed_by)
         VALUES ($1,'responded','running',$2,$3)`,
          [sla.sla_id, sla.status, scope.context.userId],
        );
    }
    if (action === "reject" || action === "release") {
      if (lead && assignment.status === "accepted")
        await applyLeadOwnership(
          client,
          lead,
          null,
          null,
          scope.context.userId,
          "unassigned",
        );
      if (assignment.queue_id)
        await client.query(
          `UPDATE queue_records SET status='waiting', claimed_by=NULL, claimed_at=NULL,
           assignment_id=NULL, updated_at=CURRENT_TIMESTAMP
         WHERE queue_id=$1 AND lead_id=$2 AND assignment_id=$3`,
          [assignment.queue_id, assignment.lead_id, assignmentId],
        );
      const cancelled = await client.query(
        `UPDATE sla_instances SET status='cancelled', updated_at=CURRENT_TIMESTAMP
         WHERE assignment_id=$1 AND status IN ('running','breached','escalated') RETURNING sla_id, status`,
        [assignmentId],
      );
      for (const sla of cancelled.rows)
        await client.query(
          `INSERT INTO sla_instance_history (sla_id, action, from_status, to_status, notes, performed_by)
         VALUES ($1,'cancelled',$2,'cancelled',$3,$4)`,
          [sla.sla_id, sla.status, reason ?? null, scope.context.userId],
        );
    }
    await client.query("COMMIT");
    return NextResponse.json({
      message: `Assignment ${targetStatus}`,
      assignment: updated.rows[0],
    });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    console.error(`Failed to ${action} assignment`, error);
    return NextResponse.json(
      { error: `Unable to ${action} assignment` },
      { status: 500 },
    );
  } finally {
    client.release();
  }
}

export async function handleAssignmentReassign(
  request: NextRequest,
  rawAssignmentId: string,
) {
  const scope = await requireOperationsContext(request);
  if (!scope.ok) return scope.response;
  const assignmentId = parseUuid(rawAssignmentId);
  if (!assignmentId)
    return NextResponse.json(
      { error: "assignmentId must be a valid UUID" },
      { status: 400 },
    );
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Request body must contain valid JSON" },
      { status: 400 },
    );
  }
  if (!isObject(body) || Array.isArray(body))
    return NextResponse.json(
      { error: "Request body must be a JSON object" },
      { status: 422 },
    );
  const existingLead =
    typeof body.lead_id === "string"
      ? body.lead_id
      : "00000000-0000-0000-0000-000000000000";
  const validation = validateAssignmentPayload({
    ...body,
    lead_id: existingLead,
  });
  if (!validation.ok)
    return NextResponse.json(
      {
        error: "Validation failed",
        details: validation.errors.filter(
          (error) => !error.startsWith("lead_id"),
        ),
      },
      { status: 422 },
    );
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      "SELECT * FROM assignments WHERE assignment_id=$1 FOR UPDATE",
      [assignmentId],
    );
    if (!result.rowCount) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: "Assignment not found" },
        { status: 404 },
      );
    }
    const assignment = result.rows[0];
    if (
      !canAccessOperationsEntity(
        scope.context.access,
        Number(assignment.company_id),
        Number(assignment.project_id),
      )
    ) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: "You do not have access to this assignment" },
        { status: 403 },
      );
    }
    if (!scope.context.access.canViewAllProjects) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: "Administrator access is required to reassign leads" },
        { status: 403 },
      );
    }
    if (!["pending", "accepted"].includes(assignment.status)) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        {
          error: `Cannot reassign an assignment with status ${assignment.status}`,
        },
        { status: 409 },
      );
    }
    await client.query(
      "UPDATE assignments SET status='reassigned', completed_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP WHERE assignment_id=$1",
      [assignmentId],
    );
    await addAssignmentHistory(
      client,
      assignment,
      "reassigned",
      "reassigned",
      scope.context.userId,
      {
        userId: validation.data.assigned_to_user_id,
        teamId: validation.data.assigned_to_team_id,
        reason: validation.data.notes,
      },
    );
    await client.query(
      "UPDATE sla_instances SET status='cancelled', updated_at=CURRENT_TIMESTAMP WHERE assignment_id=$1 AND status IN ('running','breached','escalated')",
      [assignmentId],
    );
    const next = await createAssignment(
      client,
      {
        leadId: assignment.lead_id,
        queueId: validation.data.queue_id ?? assignment.queue_id,
        userId: validation.data.assigned_to_user_id,
        teamId: validation.data.assigned_to_team_id,
        priority: validation.data.priority ?? assignment.priority,
        notes: validation.data.notes,
      },
      scope.context.userId,
    );
    await client.query("COMMIT");
    return NextResponse.json({
      message: "Assignment reassigned",
      previous_assignment_id: assignmentId,
      assignment: next,
    });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    if (error instanceof OperationsReferenceError)
      return NextResponse.json({ error: error.message }, { status: 422 });
    if (error instanceof OperationsConflictError)
      return NextResponse.json({ error: error.message }, { status: 409 });
    console.error("Failed to reassign assignment", error);
    return NextResponse.json(
      { error: "Unable to reassign assignment" },
      { status: 500 },
    );
  } finally {
    client.release();
  }
}
