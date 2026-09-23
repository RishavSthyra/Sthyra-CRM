import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import {
  ActivityReferenceError,
  NOTE_COLUMNS,
  NoteInput,
  parseActivityUuid,
  recordActivity,
  validateActivityReferences,
  validateNotePayload,
} from "@/lib/activities";
import {
  canAccessOperationsEntity,
  requireOperationsContext,
} from "@/lib/operationsAccess";
import { canAccessProject } from "@/lib/projectAccess";

type Context = { params: Promise<{ noteid: string }> };

async function canReadNote(note: Record<string, unknown>, userId: string) {
  if (note.visibility === "company" || note.created_by === userId) return true;
  if (note.visibility !== "team") return false;
  const result = await pool.query(
    "SELECT team_id FROM users WHERE user_id=$1",
    [userId],
  );
  return result.rows[0]?.team_id === note.owner_team_id;
}

export async function GET(request: NextRequest, context: Context) {
  const scope = await requireOperationsContext(request);
  if (!scope.ok) return scope.response;
  const noteId = parseActivityUuid((await context.params).noteid);
  if (!noteId)
    return NextResponse.json(
      { error: "noteId must be a valid UUID" },
      { status: 400 },
    );
  try {
    const result = await pool.query(
      `SELECT ${NOTE_COLUMNS}, p.project_name, c.first_name, c.last_name, c.email, c.phone_number, u.first_name AS author_first_name, u.last_name AS author_last_name FROM notes n JOIN projects p ON p.project_id=n.project_id LEFT JOIN contacts c ON c.contact_id=n.contact_id LEFT JOIN users u ON u.user_id=n.created_by WHERE n.note_id=$1`,
      [noteId],
    );
    if (!result.rowCount)
      return NextResponse.json({ error: "Note not found" }, { status: 404 });
    const note = result.rows[0];
    if (
      !canAccessOperationsEntity(
        scope.context.access,
        Number(note.company_id),
        Number(note.project_id),
      ) ||
      !(await canReadNote(note, scope.context.userId))
    )
      return NextResponse.json(
        { error: "You do not have access to this note" },
        { status: 403 },
      );
    return NextResponse.json({ note });
  } catch (error) {
    console.error("Failed to retrieve note", error);
    return NextResponse.json(
      { error: "Unable to retrieve note" },
      { status: 500 },
    );
  }
}

export async function PATCH(request: NextRequest, context: Context) {
  const scope = await requireOperationsContext(request);
  if (!scope.ok) return scope.response;
  const noteId = parseActivityUuid((await context.params).noteid);
  if (!noteId)
    return NextResponse.json(
      { error: "noteId must be a valid UUID" },
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
  const partial = validateNotePayload(body, true);
  if (!partial.ok)
    return NextResponse.json(
      { error: "Validation failed", details: partial.errors },
      { status: 422 },
    );
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const currentResult = await client.query(
      "SELECT * FROM notes WHERE note_id=$1 FOR UPDATE",
      [noteId],
    );
    if (!currentResult.rowCount) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "Note not found" }, { status: 404 });
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
        { error: "You do not have access to this note" },
        { status: 403 },
      );
    }
    if (
      current.created_by !== scope.context.userId &&
      !scope.context.access.canViewAllProjects
    ) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: "Only the author or an administrator can edit this note" },
        { status: 403 },
      );
    }
    if (current.archived_at) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: "Archived notes cannot be edited" },
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
      title:
        partial.data.title !== undefined ? partial.data.title : current.title,
      body: partial.data.body ?? current.body,
      visibility: partial.data.visibility ?? current.visibility,
      is_pinned: partial.data.is_pinned ?? current.is_pinned,
    };
    const complete = validateNotePayload(merged, false);
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
    const fields: (keyof NoteInput)[] = [
      "project_id",
      "lead_id",
      "contact_id",
      "title",
      "body",
      "visibility",
      "is_pinned",
    ];
    const updates = fields.filter((field) => partial.data[field] !== undefined);
    const values = updates.map((field) => partial.data[field]);
    values.push(scope.context.userId, noteId);
    const assignments = updates.map((field, index) => `${field}=$${index + 1}`);
    const result = await client.query(
      `UPDATE notes SET ${assignments.join(", ")}, updated_by=$${values.length - 1}, updated_at=CURRENT_TIMESTAMP WHERE note_id=$${values.length} RETURNING *`,
      values,
    );
    const note = result.rows[0];
    await recordActivity(
      client,
      note,
      "note",
      "note_updated",
      note.title ? `Note updated: ${note.title}` : "Note updated",
      scope.context.userId,
      { metadata: { fields: updates } },
    );
    await client.query("COMMIT");
    return NextResponse.json({ message: "Note updated", note });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    if (error instanceof ActivityReferenceError)
      return NextResponse.json({ error: error.message }, { status: 422 });
    console.error("Failed to update note", error);
    return NextResponse.json(
      { error: "Unable to update note" },
      { status: 500 },
    );
  } finally {
    client.release();
  }
}
