import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import {
  ActivityReferenceError,
  parseActivityUuid,
  recordActivity,
  validateActivityReferences,
} from "@/lib/activities";
import {
  canAccessOperationsEntity,
  requireOperationsContext,
} from "@/lib/operationsAccess";
import { isObject } from "@/utils/isObject";
import { validateText } from "@/utils/validateText";

export async function changeTaskState(
  request: NextRequest,
  rawTaskId: string,
  action: "complete" | "cancel" | "reopen",
) {
  const scope = await requireOperationsContext(request);
  if (!scope.ok) return scope.response;
  const taskId = parseActivityUuid(rawTaskId);
  if (!taskId)
    return NextResponse.json(
      { error: "taskId must be a valid UUID" },
      { status: 400 },
    );
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
  if (!isObject(body) || Array.isArray(body))
    return NextResponse.json(
      { error: "Request body must be a JSON object" },
      { status: 422 },
    );
  const errors: string[] = [];
  const reason = validateText(body.reason, "reason", 5000, true, errors);
  Object.keys(body)
    .filter((key) => key !== "reason")
    .forEach((key) => errors.push(`Unknown field: ${key}`));
  if (action === "cancel" && !reason) errors.push("reason is required");
  if (errors.length)
    return NextResponse.json(
      { error: "Validation failed", details: errors },
      { status: 422 },
    );
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const currentResult = await client.query(
      "SELECT * FROM tasks WHERE task_id=$1 FOR UPDATE",
      [taskId],
    );
    if (!currentResult.rowCount) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
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
        { error: "You do not have access to this task" },
        { status: 403 },
      );
    }
    const allowed =
      action === "reopen"
        ? ["completed", "cancelled"]
        : ["open", "in_progress"];
    if (!allowed.includes(current.status)) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: `Cannot ${action} a task with status ${current.status}` },
        { status: 409 },
      );
    }
    const status =
      action === "complete"
        ? "completed"
        : action === "cancel"
          ? "cancelled"
          : "open";
    const result = await client.query(
      `UPDATE tasks SET status=$2, updated_by=$3, updated_at=CURRENT_TIMESTAMP,
       completed_at=CASE WHEN $2='completed' THEN CURRENT_TIMESTAMP ELSE NULL END,
       completed_by=CASE WHEN $2='completed' THEN $3::uuid ELSE NULL END,
       cancelled_at=CASE WHEN $2='cancelled' THEN CURRENT_TIMESTAMP ELSE NULL END,
       cancelled_by=CASE WHEN $2='cancelled' THEN $3::uuid ELSE NULL END,
       cancellation_reason=CASE WHEN $2='cancelled' THEN $4 ELSE NULL END
       WHERE task_id=$1 RETURNING *`,
      [taskId, status, scope.context.userId, reason ?? null],
    );
    const task = result.rows[0];
    await recordActivity(
      client,
      task,
      "task",
      `task_${action === "cancel" ? "cancelled" : action === "complete" ? "completed" : "reopened"}`,
      `Task ${action === "cancel" ? "cancelled" : action === "complete" ? "completed" : "reopened"}: ${task.title}`,
      scope.context.userId,
      { description: reason },
    );
    await client.query("COMMIT");
    return NextResponse.json({ message: `Task ${status}`, task });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    console.error(`Failed to ${action} task`, error);
    return NextResponse.json(
      { error: `Unable to ${action} task` },
      { status: 500 },
    );
  } finally {
    client.release();
  }
}

export async function reassignTask(request: NextRequest, rawTaskId: string) {
  const scope = await requireOperationsContext(request);
  if (!scope.ok) return scope.response;
  const taskId = parseActivityUuid(rawTaskId);
  if (!taskId)
    return NextResponse.json(
      { error: "taskId must be a valid UUID" },
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
  const allowed = new Set([
    "assigned_to_user_id",
    "assigned_to_team_id",
    "reason",
  ]);
  const errors = Object.keys(body)
    .filter((key) => !allowed.has(key))
    .map((key) => `Unknown field: ${key}`);
  const parseOptionalUuid = (
    value: unknown,
    field: string,
  ): string | null | undefined => {
    if (value === undefined) return undefined;
    if (value === null) return null;
    const parsed = typeof value === "string" ? parseActivityUuid(value) : null;
    if (!parsed) errors.push(`${field} must be a valid UUID or null`);
    return parsed ?? undefined;
  };
  const userId = parseOptionalUuid(
    body.assigned_to_user_id,
    "assigned_to_user_id",
  );
  const teamId = parseOptionalUuid(
    body.assigned_to_team_id,
    "assigned_to_team_id",
  );
  if (userId === undefined && teamId === undefined)
    errors.push("assigned_to_user_id or assigned_to_team_id is required");
  const reason = validateText(body.reason, "reason", 5000, true, errors);
  if (errors.length)
    return NextResponse.json(
      { error: "Validation failed", details: errors },
      { status: 422 },
    );
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const currentResult = await client.query(
      "SELECT * FROM tasks WHERE task_id=$1 FOR UPDATE",
      [taskId],
    );
    if (!currentResult.rowCount) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
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
        { error: "You do not have access to this task" },
        { status: 403 },
      );
    }
    if (["completed", "cancelled"].includes(current.status)) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: "Only an active task can be reassigned" },
        { status: 409 },
      );
    }
    const nextUser =
      userId !== undefined ? userId : current.assigned_to_user_id;
    const nextTeam =
      teamId !== undefined ? teamId : current.assigned_to_team_id;
    await validateActivityReferences(client, Number(current.company_id), {
      project_id: Number(current.project_id),
      assigned_to_user_id: nextUser,
      assigned_to_team_id: nextTeam,
    });
    const result = await client.query(
      `UPDATE tasks SET assigned_to_user_id=$2, assigned_to_team_id=$3, updated_by=$4, updated_at=CURRENT_TIMESTAMP WHERE task_id=$1 RETURNING *`,
      [taskId, nextUser, nextTeam, scope.context.userId],
    );
    const task = result.rows[0];
    await recordActivity(
      client,
      task,
      "task",
      "task_reassigned",
      `Task reassigned: ${task.title}`,
      scope.context.userId,
      {
        description: reason,
        metadata: {
          from_user_id: current.assigned_to_user_id,
          to_user_id: nextUser,
          from_team_id: current.assigned_to_team_id,
          to_team_id: nextTeam,
        },
      },
    );
    await client.query("COMMIT");
    return NextResponse.json({ message: "Task reassigned", task });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    if (error instanceof ActivityReferenceError)
      return NextResponse.json({ error: error.message }, { status: 422 });
    console.error("Failed to reassign task", error);
    return NextResponse.json(
      { error: "Unable to reassign task" },
      { status: 500 },
    );
  } finally {
    client.release();
  }
}
