import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { parseActivityUuid, recordActivity } from "@/lib/activities";
import {
  CALL_COLUMNS,
  resolveCommunicationContact,
  validateCallPayload,
} from "@/lib/communications";
import { requireOperationsContext } from "@/lib/operationsAccess";
import { canAccessProject, getAccessibleProjectIds } from "@/lib/projectAccess";
import { parsePagination } from "@/utils/parsePagination";
import { parsePositiveInteger } from "@/utils/parsePositiveInteger";

export async function GET(request: NextRequest) {
  const scope = await requireOperationsContext(request);
  if (!scope.ok) return scope.response;
  const pagination = parsePagination(request.nextUrl.searchParams, 30, 100);
  if (!pagination.ok) {
    return NextResponse.json({ error: pagination.error }, { status: 400 });
  }
  const values: unknown[] = [getAccessibleProjectIds(scope.context.access)];
  const filters = ["c.project_id=ANY($1::integer[])"];
  const projectValue = request.nextUrl.searchParams.get("project_id");
  if (projectValue) {
    const projectId = parsePositiveInteger(projectValue);
    if (!projectId || !canAccessProject(scope.context.access, projectId)) {
      return NextResponse.json(
        { error: "Invalid or inaccessible project_id" },
        { status: 400 },
      );
    }
    values.push(projectId);
    filters.push(`c.project_id=$${values.length}`);
  }
  for (const field of ["lead_id", "contact_id", "owner_user_id"] as const) {
    const raw = request.nextUrl.searchParams.get(field);
    if (!raw) continue;
    const id = parseActivityUuid(raw);
    if (!id) {
      return NextResponse.json(
        { error: `${field} must be a valid UUID` },
        { status: 400 },
      );
    }
    values.push(id);
    filters.push(`c.${field}=$${values.length}`);
  }
  const direction = request.nextUrl.searchParams.get("direction");
  if (direction) {
    if (!['inbound', 'outbound'].includes(direction)) {
      return NextResponse.json({ error: "Invalid call direction" }, { status: 400 });
    }
    values.push(direction);
    filters.push(`c.direction=$${values.length}`);
  }
  const status = request.nextUrl.searchParams.get("status");
  if (status) {
    if (!['scheduled', 'initiating', 'queued', 'ringing', 'answered', 'in_progress', 'on_hold', 'missed', 'completed', 'failed', 'busy', 'no_answer', 'cancelled'].includes(status)) {
      return NextResponse.json({ error: "Invalid call status" }, { status: 400 });
    }
    values.push(status);
    filters.push(`c.status=$${values.length}`);
  }
  const search = request.nextUrl.searchParams.get("search")?.trim();
  if (search) {
    values.push(`%${search}%`);
    filters.push(
      `(c.subject ILIKE $${values.length} OR c.summary ILIKE $${values.length} OR c.phone_number ILIKE $${values.length})`,
    );
  }
  const where = `WHERE ${filters.join(" AND ")}`;
  try {
    const count = await pool.query(
      `SELECT COUNT(*)::integer AS total FROM calls c ${where}`,
      values,
    );
    const listValues = [...values, pagination.limit, pagination.offset];
    const result = await pool.query(
      `SELECT ${CALL_COLUMNS}, p.project_name,
        ct.first_name AS contact_first_name, ct.last_name AS contact_last_name,
        u.first_name AS owner_first_name, u.last_name AS owner_last_name
       FROM calls c
       JOIN projects p ON p.project_id=c.project_id
       LEFT JOIN contacts ct ON ct.contact_id=c.contact_id
       LEFT JOIN users u ON u.user_id=c.owner_user_id
       ${where}
       ORDER BY c.started_at DESC, c.call_id DESC
       LIMIT $${listValues.length - 1} OFFSET $${listValues.length}`,
      listValues,
    );
    const total = Number(count.rows[0]?.total ?? 0);
    return NextResponse.json({
      calls: result.rows,
      pagination: {
        page: pagination.page,
        limit: pagination.limit,
        total,
        totalPages: Math.ceil(total / pagination.limit),
      },
    });
  } catch (error) {
    console.error("Failed to list calls", error);
    return NextResponse.json({ error: "Unable to retrieve calls" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const scope = await requireOperationsContext(request);
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
  const validation = validateCallPayload(body);
  if (!validation.ok) {
    return NextResponse.json(
      { error: "Validation failed", details: validation.errors },
      { status: 422 },
    );
  }
  if (!canAccessProject(scope.context.access, validation.data.project_id)) {
    return NextResponse.json(
      { error: "You do not have access to this project" },
      { status: 403 },
    );
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const contactId = await resolveCommunicationContact(
      client,
      scope.context.access.company.company_id,
      validation.data.project_id,
      validation.data.lead_id,
      validation.data.contact_id,
    );
    const result = await client.query(
      `INSERT INTO calls (
         company_id, project_id, lead_id, contact_id, direction, status,
         outcome, phone_number, subject, summary, started_at, ended_at,
         duration_seconds, owner_user_id, created_by
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,
         COALESCE($13, CASE WHEN $12::timestamptz IS NOT NULL
           THEN GREATEST(0, EXTRACT(EPOCH FROM ($12::timestamptz-$11::timestamptz))::integer)
           ELSE NULL END), $14, $14)
       RETURNING *`,
      [
        scope.context.access.company.company_id,
        validation.data.project_id,
        validation.data.lead_id ?? null,
        contactId,
        validation.data.direction ?? "outbound",
        validation.data.status ?? "completed",
        validation.data.outcome ?? null,
        validation.data.phone_number,
        validation.data.subject,
        validation.data.summary ?? null,
        validation.data.started_at,
        validation.data.ended_at ?? null,
        validation.data.duration_seconds ?? null,
        scope.context.userId,
      ],
    );
    const call = result.rows[0];
    await recordActivity(
      client,
      call,
      "call",
      "call_logged",
      `${call.direction === "inbound" ? "Inbound" : "Outbound"} call: ${call.subject}`,
      scope.context.userId,
      {
        description: call.summary,
        metadata: {
          direction: call.direction,
          status: call.status,
          outcome: call.outcome,
          duration_seconds: call.duration_seconds,
          phone_number: call.phone_number,
        },
        occurredAt: call.started_at,
      },
    );
    await client.query("COMMIT");
    return NextResponse.json({ message: "Call logged", call }, { status: 201 });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    const message = error instanceof Error ? error.message : "Unable to log call";
    if (message.includes("lead_id") || message.includes("contact_id")) {
      return NextResponse.json({ error: message }, { status: 422 });
    }
    console.error("Failed to create call", error);
    return NextResponse.json({ error: "Unable to log call" }, { status: 500 });
  } finally {
    client.release();
  }
}
