import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import {
  claimOrAssignNext,
  getQueueForUpdate,
  OperationsConflictError,
  OperationsReferenceError,
} from "@/lib/assignmentService";
import { parseUuid } from "@/lib/operations";
import {
  canAccessOperationsEntity,
  requireOperationsContext,
} from "@/lib/operationsAccess";
import { isObject } from "@/utils/isObject";

async function parseOptionalBody(request: NextRequest) {
  const text = await request.text();
  if (!text.trim())
    return { ok: true as const, body: {} as Record<string, unknown> };
  try {
    const body = JSON.parse(text);
    if (!isObject(body) || Array.isArray(body)) return { ok: false as const };
    return { ok: true as const, body };
  } catch {
    return { ok: false as const };
  }
}

export async function handleQueueAssignment(
  request: NextRequest,
  rawQueueId: string,
  autoAssign: boolean,
) {
  const scope = await requireOperationsContext(request);
  if (!scope.ok) return scope.response;
  const queueId = parseUuid(rawQueueId);
  if (!queueId)
    return NextResponse.json(
      { error: "queueId must be a valid UUID" },
      { status: 400 },
    );
  const parsed = await parseOptionalBody(request);
  if (!parsed.ok)
    return NextResponse.json(
      { error: "Request body must contain a valid JSON object" },
      { status: 400 },
    );
  const allowed = autoAssign ? new Set(["user_id"]) : new Set(["lead_id"]);
  const unknown = Object.keys(parsed.body).filter((key) => !allowed.has(key));
  if (unknown.length)
    return NextResponse.json(
      {
        error: "Validation failed",
        details: unknown.map((key) => `Unknown field: ${key}`),
      },
      { status: 422 },
    );
  const leadId =
    parsed.body.lead_id === undefined
      ? null
      : parseUuid(String(parsed.body.lead_id));
  const userId =
    parsed.body.user_id === undefined
      ? null
      : parseUuid(String(parsed.body.user_id));
  if (parsed.body.lead_id !== undefined && !leadId)
    return NextResponse.json(
      { error: "lead_id must be a valid UUID" },
      { status: 422 },
    );
  if (parsed.body.user_id !== undefined && !userId)
    return NextResponse.json(
      { error: "user_id must be a valid UUID" },
      { status: 422 },
    );
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const queue = await getQueueForUpdate(client, queueId);
    if (!queue) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "Queue not found" }, { status: 404 });
    }
    if (
      !canAccessOperationsEntity(
        scope.context.access,
        Number(queue.company_id),
        queue.project_id === null ? null : Number(queue.project_id),
      )
    ) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: "You do not have access to this queue" },
        { status: 403 },
      );
    }
    if (autoAssign && !scope.context.access.canViewAllProjects) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        {
          error:
            "Administrator access is required to assign the next queue record",
        },
        { status: 403 },
      );
    }
    if (!autoAssign && !scope.context.access.canViewAllProjects) {
      const membership = await client.query(
        "SELECT 1 FROM queue_members WHERE queue_id=$1 AND user_id=$2 AND is_active=TRUE",
        [queueId, scope.context.userId],
      );
      if (!membership.rowCount) {
        await client.query("ROLLBACK");
        return NextResponse.json(
          { error: "You must be an active queue member to claim records" },
          { status: 403 },
        );
      }
    }
    const assignment = await claimOrAssignNext(
      client,
      queue,
      scope.context.userId,
      { leadId, userId, autoAssign },
    );
    await client.query("COMMIT");
    return NextResponse.json({
      message: autoAssign
        ? "Next queue record assigned"
        : "Queue record claimed",
      assignment,
    });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    if (error instanceof OperationsReferenceError)
      return NextResponse.json({ error: error.message }, { status: 422 });
    if (error instanceof OperationsConflictError)
      return NextResponse.json({ error: error.message }, { status: 409 });
    console.error("Failed to assign queue record", error);
    return NextResponse.json(
      { error: "Unable to assign queue record" },
      { status: 500 },
    );
  } finally {
    client.release();
  }
}
