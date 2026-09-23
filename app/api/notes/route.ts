import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import {
  ActivityReferenceError,
  NOTE_COLUMNS,
  parseActivityUuid,
  recordActivity,
  validateActivityReferences,
  validateNotePayload,
} from "@/lib/activities";
import { requireOperationsContext } from "@/lib/operationsAccess";
import { canAccessProject, getAccessibleProjectIds } from "@/lib/projectAccess";
import { parsePagination } from "@/utils/parsePagination";
import { parsePositiveInteger } from "@/utils/parsePositiveInteger";

export async function GET(request: NextRequest) {
  const scope = await requireOperationsContext(request);
  if (!scope.ok) return scope.response;
  const pagination = parsePagination(request.nextUrl.searchParams);
  if (!pagination.ok)
    return NextResponse.json({ error: pagination.error }, { status: 400 });
  const values: unknown[] = [
    getAccessibleProjectIds(scope.context.access),
    scope.context.userId,
  ];
  const filters = [
    "n.project_id=ANY($1::integer[])",
    `(n.visibility='company' OR n.created_by=$2 OR (n.visibility='team' AND n.owner_team_id=(SELECT team_id FROM users WHERE user_id=$2)))`,
  ];
  const archived = request.nextUrl.searchParams.get("archived");
  if (archived && !["true", "false"].includes(archived))
    return NextResponse.json(
      { error: "archived must be true or false" },
      { status: 400 },
    );
  filters.push(
    archived === "true" ? "n.archived_at IS NOT NULL" : "n.archived_at IS NULL",
  );
  const projectValue = request.nextUrl.searchParams.get("project_id");
  if (projectValue) {
    const projectId = parsePositiveInteger(projectValue);
    if (!projectId || !canAccessProject(scope.context.access, projectId))
      return NextResponse.json(
        { error: "Invalid or inaccessible project_id" },
        { status: 400 },
      );
    values.push(projectId);
    filters.push(`n.project_id=$${values.length}`);
  }
  for (const field of ["lead_id", "contact_id", "created_by"] as const) {
    const raw = request.nextUrl.searchParams.get(field);
    if (!raw) continue;
    const id = parseActivityUuid(raw);
    if (!id)
      return NextResponse.json(
        { error: `${field} must be a valid UUID` },
        { status: 400 },
      );
    values.push(id);
    filters.push(`n.${field}=$${values.length}`);
  }
  const visibility = request.nextUrl.searchParams.get("visibility");
  if (visibility) {
    if (!["private", "team", "company"].includes(visibility))
      return NextResponse.json(
        { error: "Invalid note visibility" },
        { status: 400 },
      );
    values.push(visibility);
    filters.push(`n.visibility=$${values.length}`);
  }
  const search = request.nextUrl.searchParams.get("search")?.trim();
  if (search) {
    values.push(`%${search}%`);
    filters.push(
      `(n.title ILIKE $${values.length} OR n.body ILIKE $${values.length})`,
    );
  }
  const where = `WHERE ${filters.join(" AND ")}`;
  try {
    const count = await pool.query(
      `SELECT COUNT(*)::integer AS total FROM notes n ${where}`,
      values,
    );
    const listValues = [...values, pagination.limit, pagination.offset];
    const result = await pool.query(
      `SELECT ${NOTE_COLUMNS}, p.project_name, c.first_name, c.last_name,
        u.first_name AS author_first_name, u.last_name AS author_last_name
       FROM notes n JOIN projects p ON p.project_id=n.project_id
       LEFT JOIN contacts c ON c.contact_id=n.contact_id
       LEFT JOIN users u ON u.user_id=n.created_by
       ${where} ORDER BY n.is_pinned DESC, n.updated_at DESC, n.note_id DESC
       LIMIT $${listValues.length - 1} OFFSET $${listValues.length}`,
      listValues,
    );
    const total = Number(count.rows[0]?.total ?? 0);
    return NextResponse.json({
      notes: result.rows,
      pagination: {
        page: pagination.page,
        limit: pagination.limit,
        total,
        totalPages: Math.ceil(total / pagination.limit),
      },
    });
  } catch (error) {
    console.error("Failed to list notes", error);
    return NextResponse.json(
      { error: "Unable to retrieve notes" },
      { status: 500 },
    );
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
  const validation = validateNotePayload(body, false);
  if (!validation.ok)
    return NextResponse.json(
      { error: "Validation failed", details: validation.errors },
      { status: 422 },
    );
  if (
    !canAccessProject(
      scope.context.access,
      validation.data.project_id as number,
    )
  )
    return NextResponse.json(
      { error: "You do not have access to this project" },
      { status: 403 },
    );
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await validateActivityReferences(
      client,
      scope.context.access.company.company_id,
      validation.data,
    );
    const user = await client.query(
      "SELECT team_id FROM users WHERE user_id=$1",
      [scope.context.userId],
    );
    const result = await client.query(
      `INSERT INTO notes (company_id, project_id, lead_id, contact_id, title,
        body, visibility, owner_team_id, is_pinned, created_by, updated_by)
       VALUES ($1,$2,$3,COALESCE($4,(SELECT contact_id FROM leads WHERE lead_id=$3)),
        $5,$6,$7,$8,$9,$10,$10) RETURNING *`,
      [
        scope.context.access.company.company_id,
        validation.data.project_id,
        validation.data.lead_id ?? null,
        validation.data.contact_id ?? null,
        validation.data.title ?? null,
        validation.data.body,
        validation.data.visibility ?? "team",
        user.rows[0]?.team_id ?? null,
        validation.data.is_pinned ?? false,
        scope.context.userId,
      ],
    );
    const note = result.rows[0];
    await recordActivity(
      client,
      note,
      "note",
      "note_created",
      note.title ? `Note created: ${note.title}` : "Note created",
      scope.context.userId,
    );
    await client.query("COMMIT");
    return NextResponse.json(
      { message: "Note created", note },
      { status: 201 },
    );
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    if (error instanceof ActivityReferenceError)
      return NextResponse.json({ error: error.message }, { status: 422 });
    console.error("Failed to create note", error);
    return NextResponse.json(
      { error: "Unable to create note" },
      { status: 500 },
    );
  } finally {
    client.release();
  }
}
