import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { parseActivityUuid, recordActivity } from "@/lib/activities";
import {
  canAccessOperationsEntity,
  requireOperationsContext,
} from "@/lib/operationsAccess";

type Context = { params: Promise<{ noteid: string }> };
export async function POST(request: NextRequest, context: Context) {
  const scope = await requireOperationsContext(request);
  if (!scope.ok) return scope.response;
  const noteId = parseActivityUuid((await context.params).noteid);
  if (!noteId)
    return NextResponse.json(
      { error: "noteId must be a valid UUID" },
      { status: 400 },
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
        { error: "Only the author or an administrator can archive this note" },
        { status: 403 },
      );
    }
    if (current.archived_at) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: "Note is already archived" },
        { status: 409 },
      );
    }
    const result = await client.query(
      "UPDATE notes SET archived_at=CURRENT_TIMESTAMP, archived_by=$2, updated_by=$2, updated_at=CURRENT_TIMESTAMP WHERE note_id=$1 RETURNING *",
      [noteId, scope.context.userId],
    );
    const note = result.rows[0];
    await recordActivity(
      client,
      note,
      "note",
      "note_archived",
      note.title ? `Note archived: ${note.title}` : "Note archived",
      scope.context.userId,
    );
    await client.query("COMMIT");
    return NextResponse.json({ message: "Note archived", note });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    console.error("Failed to archive note", error);
    return NextResponse.json(
      { error: "Unable to archive note" },
      { status: 500 },
    );
  } finally {
    client.release();
  }
}
