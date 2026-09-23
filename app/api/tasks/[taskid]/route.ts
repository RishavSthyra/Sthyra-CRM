import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import {
  ActivityReferenceError,
  parseActivityUuid,
  recordActivity,
  TASK_COLUMNS,
  TaskInput,
  validateActivityReferences,
  validateTaskPayload,
} from "@/lib/activities";
import {
  canAccessOperationsEntity,
  requireOperationsContext,
} from "@/lib/operationsAccess";
import { canAccessProject } from "@/lib/projectAccess";

type Context = { params: Promise<{ taskid: string }> };

export async function GET(request: NextRequest, context: Context) {
  const scope = await requireOperationsContext(request);
  if (!scope.ok) return scope.response;
  const taskId = parseActivityUuid((await context.params).taskid);
  if (!taskId)
    return NextResponse.json(
      { error: "taskId must be a valid UUID" },
      { status: 400 },
    );
  try {
    const result = await pool.query(
      `SELECT ${TASK_COLUMNS}, p.project_name, c.first_name, c.last_name,
        c.email, c.phone_number, u.first_name AS assignee_first_name,
        u.last_name AS assignee_last_name, team.name AS assigned_team_name
       FROM tasks t JOIN projects p ON p.project_id=t.project_id
       LEFT JOIN contacts c ON c.contact_id=t.contact_id
       LEFT JOIN users u ON u.user_id=t.assigned_to_user_id
       LEFT JOIN teams team ON team.team_id=t.assigned_to_team_id
       WHERE t.task_id=$1`,
      [taskId],
    );
    if (!result.rowCount)
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    const task = result.rows[0];
    if (
      !canAccessOperationsEntity(
        scope.context.access,
        Number(task.company_id),
        Number(task.project_id),
      )
    )
      return NextResponse.json(
        { error: "You do not have access to this task" },
        { status: 403 },
      );
    return NextResponse.json({ task });
  } catch (error) {
    console.error("Failed to retrieve task", error);
    return NextResponse.json(
      { error: "Unable to retrieve task" },
      { status: 500 },
    );
  }
}

export async function PATCH(request: NextRequest, context: Context) {
  const scope = await requireOperationsContext(request);
  if (!scope.ok) return scope.response;
  const taskId = parseActivityUuid((await context.params).taskid);
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
  const partial = validateTaskPayload(body, true);
  if (!partial.ok)
    return NextResponse.json(
      { error: "Validation failed", details: partial.errors },
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
        { error: "Reopen the task before editing it" },
        { status: 409 },
      );
    }
    const merged = {
      project_id: partial.data.project_id ?? current.project_id,
      lead_id:
        partial.data.lead_id !== undefined
          ? partial.data.lead_id
          : current.lead_id,
      contact_id:
        partial.data.contact_id !== undefined
          ? partial.data.contact_id
          : current.contact_id,
      title: partial.data.title ?? current.title,
      description:
        partial.data.description !== undefined
          ? partial.data.description
          : current.description,
      priority: partial.data.priority ?? current.priority,
      status: partial.data.status ?? current.status,
      due_at:
        partial.data.due_at !== undefined
          ? partial.data.due_at
          : current.due_at,
      assigned_to_user_id:
        partial.data.assigned_to_user_id !== undefined
          ? partial.data.assigned_to_user_id
          : current.assigned_to_user_id,
      assigned_to_team_id:
        partial.data.assigned_to_team_id !== undefined
          ? partial.data.assigned_to_team_id
          : current.assigned_to_team_id,
    };
    const complete = validateTaskPayload(merged, false);
    if (!complete.ok) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: "Validation failed", details: complete.errors },
        { status: 422 },
      );
    }
    if (
      !canAccessProject(
        scope.context.access,
        complete.data.project_id as number,
      )
    ) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: "You do not have access to the target project" },
        { status: 403 },
      );
    }
    await validateActivityReferences(
      client,
      scope.context.access.company.company_id,
      complete.data,
    );
    const fields: (keyof TaskInput)[] = [
      "project_id",
      "lead_id",
      "contact_id",
      "title",
      "description",
      "priority",
      "status",
      "due_at",
      "assigned_to_user_id",
      "assigned_to_team_id",
    ];
    const updates = fields.filter((field) => partial.data[field] !== undefined);
    const values = updates.map((field) => partial.data[field]);
    values.push(scope.context.userId, taskId);
    const assignments = updates.map((field, index) => `${field}=$${index + 1}`);
    const result = await client.query(
      `UPDATE tasks SET ${assignments.join(", ")}, updated_by=$${values.length - 1}, updated_at=CURRENT_TIMESTAMP WHERE task_id=$${values.length} RETURNING *`,
      values,
    );
    const task = result.rows[0];
    await recordActivity(
      client,
      task,
      "task",
      "task_updated",
      `Task updated: ${task.title}`,
      scope.context.userId,
      { metadata: { fields: updates } },
    );
    await client.query("COMMIT");
    return NextResponse.json({ message: "Task updated", task });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    if (error instanceof ActivityReferenceError)
      return NextResponse.json({ error: error.message }, { status: 422 });
    console.error("Failed to update task", error);
    return NextResponse.json(
      { error: "Unable to update task" },
      { status: 500 },
    );
  } finally {
    client.release();
  }
}
