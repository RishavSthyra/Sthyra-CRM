import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { ASSIGNMENT_COLUMNS, parseUuid } from "@/lib/operations";
import {
  canAccessOperationsEntity,
  requireOperationsContext,
} from "@/lib/operationsAccess";

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
  try {
    const result = await pool.query(
      `SELECT ${ASSIGNMENT_COLUMNS},
        c.first_name, c.last_name, c.email, c.phone_number,
        p.project_name, q.queue_name,
        u.first_name AS assignee_first_name, u.last_name AS assignee_last_name,
        t.name AS assigned_team_name
       FROM assignments a
       JOIN leads l ON l.lead_id=a.lead_id
       JOIN contacts c ON c.contact_id=l.contact_id
       JOIN projects p ON p.project_id=a.project_id
       LEFT JOIN queues q ON q.queue_id=a.queue_id
       LEFT JOIN users u ON u.user_id=a.assigned_to_user_id
       LEFT JOIN teams t ON t.team_id=a.assigned_to_team_id
       WHERE a.assignment_id=$1`,
      [assignmentId],
    );
    if (!result.rowCount)
      return NextResponse.json(
        { error: "Assignment not found" },
        { status: 404 },
      );
    const assignment = result.rows[0];
    if (
      !canAccessOperationsEntity(
        scope.context.access,
        Number(assignment.company_id),
        Number(assignment.project_id),
      )
    )
      return NextResponse.json(
        { error: "You do not have access to this assignment" },
        { status: 403 },
      );
    return NextResponse.json({ assignment });
  } catch (error) {
    console.error("Failed to retrieve assignment", error);
    return NextResponse.json(
      { error: "Unable to retrieve assignment" },
      { status: 500 },
    );
  }
}
