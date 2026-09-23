import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { parseUuid } from "@/lib/operations";
import {
  canAccessOperationsEntity,
  requireOperationsContext,
} from "@/lib/operationsAccess";
import { parsePagination } from "@/utils/parsePagination";

type Context = { params: Promise<{ assignmentid: string }> };

export async function GET(request: NextRequest, context: Context) {
  const scope = await requireOperationsContext(request);
  if (!scope.ok) return scope.response;
  const assignmentId = parseUuid((await context.params).assignmentid);
  if (!assignmentId)
    return NextResponse.json(
      { error: "assignmentId must be a valid UUID" },
      { status: 400 },
    );
  const pagination = parsePagination(request.nextUrl.searchParams, 50);
  if (!pagination.ok)
    return NextResponse.json({ error: pagination.error }, { status: 400 });
  try {
    const assignment = await pool.query(
      "SELECT company_id, project_id FROM assignments WHERE assignment_id=$1",
      [assignmentId],
    );
    if (!assignment.rowCount)
      return NextResponse.json(
        { error: "Assignment not found" },
        { status: 404 },
      );
    if (
      !canAccessOperationsEntity(
        scope.context.access,
        Number(assignment.rows[0].company_id),
        Number(assignment.rows[0].project_id),
      )
    )
      return NextResponse.json(
        { error: "You do not have access to this assignment" },
        { status: 403 },
      );
    const count = await pool.query(
      "SELECT COUNT(*)::integer AS total FROM assignment_history WHERE assignment_id=$1",
      [assignmentId],
    );
    const result = await pool.query(
      `SELECT h.*, u.first_name AS performed_by_first_name, u.last_name AS performed_by_last_name
       FROM assignment_history h LEFT JOIN users u ON u.user_id=h.performed_by
       WHERE h.assignment_id=$1
       ORDER BY h.created_at DESC, h.history_id DESC
       LIMIT $2 OFFSET $3`,
      [assignmentId, pagination.limit, pagination.offset],
    );
    const total = Number(count.rows[0]?.total ?? 0);
    return NextResponse.json({
      history: result.rows,
      pagination: {
        page: pagination.page,
        limit: pagination.limit,
        total,
        totalPages: Math.ceil(total / pagination.limit),
      },
    });
  } catch (error) {
    console.error("Failed to retrieve assignment history", error);
    return NextResponse.json(
      { error: "Unable to retrieve assignment history" },
      { status: 500 },
    );
  }
}
