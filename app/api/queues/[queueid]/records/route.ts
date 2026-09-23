import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { parseUuid } from "@/lib/operations";
import {
  canAccessOperationsEntity,
  requireOperationsContext,
} from "@/lib/operationsAccess";
import { parsePagination } from "@/utils/parsePagination";

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
  const pagination = parsePagination(request.nextUrl.searchParams);
  if (!pagination.ok)
    return NextResponse.json({ error: pagination.error }, { status: 400 });
  const statuses = ["waiting", "claimed", "assigned", "removed"];
  const status = request.nextUrl.searchParams.get("status");
  if (status && !statuses.includes(status))
    return NextResponse.json(
      { error: "Invalid queue record status" },
      { status: 400 },
    );
  try {
    const queueResult = await pool.query(
      "SELECT company_id, project_id FROM queues WHERE queue_id=$1",
      [queueId],
    );
    if (!queueResult.rowCount)
      return NextResponse.json({ error: "Queue not found" }, { status: 404 });
    const queue = queueResult.rows[0];
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
    const values: unknown[] = [queueId];
    const filters = ["qr.queue_id=$1"];
    if (status) {
      values.push(status);
      filters.push(`qr.status=$${values.length}`);
    }
    const where = `WHERE ${filters.join(" AND ")}`;
    const count = await pool.query(
      `SELECT COUNT(*)::integer AS total FROM queue_records qr ${where}`,
      values,
    );
    const listValues = [...values, pagination.limit, pagination.offset];
    const result = await pool.query(
      `SELECT qr.*, l.status AS lead_status, l.temperature,
        c.first_name, c.last_name, c.email, c.phone_number,
        p.project_name
       FROM queue_records qr
       JOIN leads l ON l.lead_id=qr.lead_id
       JOIN contacts c ON c.contact_id=l.contact_id
       JOIN projects p ON p.project_id=l.project_id
       ${where}
       ORDER BY qr.priority DESC, qr.available_at, qr.created_at
       LIMIT $${listValues.length - 1} OFFSET $${listValues.length}`,
      listValues,
    );
    const total = Number(count.rows[0]?.total ?? 0);
    return NextResponse.json({
      records: result.rows,
      pagination: {
        page: pagination.page,
        limit: pagination.limit,
        total,
        totalPages: Math.ceil(total / pagination.limit),
      },
    });
  } catch (error) {
    console.error("Failed to retrieve queue records", error);
    return NextResponse.json(
      { error: "Unable to retrieve queue records" },
      { status: 500 },
    );
  }
}
