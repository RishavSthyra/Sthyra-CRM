import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { OperationsReferenceError } from "@/lib/assignmentService";
import {
  parseUuid,
  QUEUE_COLUMNS,
  QueueInput,
  validateQueuePayload,
} from "@/lib/operations";
import {
  canAccessOperationsEntity,
  requireOperationsContext,
} from "@/lib/operationsAccess";
import {
  replaceQueueMembers,
  validateQueueReferences,
} from "@/lib/queueService";
import { getDatabaseErrorCode } from "@/utils/getDatabaseErrorCode";

type Context = { params: Promise<{ queueid: string }> };

export async function GET(request: NextRequest, context: Context) {
  const scope = await requireOperationsContext(request);
  if (!scope.ok) return scope.response;
  const queueId = parseUuid((await context.params).queueid);
  if (!queueId)
    return NextResponse.json(
      { error: "queueId must be a valid UUID" },
      { status: 400 },
    );
  try {
    const result = await pool.query(
      `SELECT ${QUEUE_COLUMNS}, p.project_name, t.name AS team_name,
        COALESCE(jsonb_agg(jsonb_build_object(
          'user_id', u.user_id, 'first_name', u.first_name,
          'last_name', u.last_name, 'email', u.email, 'position', qm.position
        ) ORDER BY qm.position) FILTER (WHERE qm.user_id IS NOT NULL), '[]'::jsonb) AS members
       FROM queues q
       LEFT JOIN projects p ON p.project_id=q.project_id
       LEFT JOIN teams t ON t.team_id=q.team_id
       LEFT JOIN queue_members qm ON qm.queue_id=q.queue_id AND qm.is_active=TRUE
       LEFT JOIN users u ON u.user_id=qm.user_id
       WHERE q.queue_id=$1
       GROUP BY q.queue_id, p.project_name, t.name`,
      [queueId],
    );
    if (!result.rowCount)
      return NextResponse.json({ error: "Queue not found" }, { status: 404 });
    const queue = result.rows[0];
    if (
      !canAccessOperationsEntity(
        scope.context.access,
        Number(queue.company_id),
        queue.project_id === null ? null : Number(queue.project_id),
      )
    )
      return NextResponse.json(
        { error: "You do not have access to this queue" },
        { status: 403 },
      );
    return NextResponse.json({ queue });
  } catch (error) {
    console.error("Failed to retrieve queue", error);
    return NextResponse.json(
      { error: "Unable to retrieve queue" },
      { status: 500 },
    );
  }
}

export async function PATCH(request: NextRequest, context: Context) {
  const scope = await requireOperationsContext(request);
  if (!scope.ok) return scope.response;
  if (!scope.context.access.canViewAllProjects)
    return NextResponse.json(
      { error: "Administrator access is required to update queues" },
      { status: 403 },
    );
  const queueId = parseUuid((await context.params).queueid);
  if (!queueId)
    return NextResponse.json(
      { error: "queueId must be a valid UUID" },
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
  const validation = validateQueuePayload(body, true);
  if (!validation.ok)
    return NextResponse.json(
      { error: "Validation failed", details: validation.errors },
      { status: 422 },
    );
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const current = await client.query(
      "SELECT * FROM queues WHERE queue_id=$1 FOR UPDATE",
      [queueId],
    );
    if (!current.rowCount) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "Queue not found" }, { status: 404 });
    }
    if (
      Number(current.rows[0].company_id) !==
      scope.context.access.company.company_id
    ) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: "You do not have access to this queue" },
        { status: 403 },
      );
    }
    await validateQueueReferences(
      client,
      scope.context.access.company.company_id,
      validation.data,
    );
    const fields: (keyof QueueInput)[] = [
      "project_id",
      "team_id",
      "queue_code",
      "queue_name",
      "description",
      "assignment_strategy",
      "is_active",
    ];
    const updates = fields.filter(
      (field) => validation.data[field] !== undefined,
    );
    let queue = current.rows[0];
    if (updates.length) {
      const values = updates.map((field) => validation.data[field]);
      values.push(queueId);
      const assignments = updates.map(
        (field, index) => `${field}=$${index + 1}`,
      );
      const result = await client.query(
        `UPDATE queues SET ${assignments.join(", ")}, updated_at=CURRENT_TIMESTAMP WHERE queue_id=$${values.length} RETURNING *`,
        values,
      );
      queue = result.rows[0];
    }
    if (validation.data.member_user_ids)
      await replaceQueueMembers(
        client,
        queueId,
        validation.data.member_user_ids,
      );
    await client.query("COMMIT");
    return NextResponse.json({ message: "Queue updated", queue });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    if (error instanceof OperationsReferenceError)
      return NextResponse.json({ error: error.message }, { status: 422 });
    if (getDatabaseErrorCode(error) === "23505")
      return NextResponse.json(
        { error: "Queue code already exists for this company" },
        { status: 409 },
      );
    console.error("Failed to update queue", error);
    return NextResponse.json(
      { error: "Unable to update queue" },
      { status: 500 },
    );
  } finally {
    client.release();
  }
}
