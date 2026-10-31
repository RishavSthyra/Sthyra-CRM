import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { ATTENTION_ELIGIBLE_LEAD_STATUSES } from "@/lib/leadAttention";
import { requireLeadVisibility } from "@/lib/leadVisibility";
import {
  canAccessProject,
  getAccessibleProjectIds,
} from "@/lib/projectAccess";
import { parsePositiveInteger } from "@/utils/parsePositiveInteger";

export async function GET(request: NextRequest) {
  const scope = await requireLeadVisibility(request, "LEADS_VIEW");
  if (!scope.ok) return scope.response;

  const from = request.nextUrl.searchParams.get("from");
  const to = request.nextUrl.searchParams.get("to");
  const fromDate = from ? new Date(from) : null;
  const toDate = to ? new Date(to) : null;
  if (
    !fromDate ||
    !toDate ||
    Number.isNaN(fromDate.getTime()) ||
    Number.isNaN(toDate.getTime()) ||
    fromDate >= toDate
  ) {
    return NextResponse.json(
      { error: "from and to must define a valid date range" },
      { status: 400 },
    );
  }

  const values: unknown[] = [fromDate.toISOString(), toDate.toISOString()];
  const filters = [
    "next_action.status='pending'",
    "next_action.due_at >= $1",
    "next_action.due_at < $2",
  ];
  values.push([...ATTENTION_ELIGIBLE_LEAD_STATUSES]);
  filters.push(`lead.status=ANY($${values.length}::varchar[])`);

  const projectValue = request.nextUrl.searchParams.get("project_id");
  if (projectValue && projectValue !== "all") {
    const projectId = parsePositiveInteger(projectValue);
    if (!projectId) {
      return NextResponse.json(
        { error: "project_id must be a positive integer" },
        { status: 400 },
      );
    }
    if (!canAccessProject(scope.context.access, projectId)) {
      return NextResponse.json(
        { error: "You do not have access to this project" },
        { status: 403 },
      );
    }
    values.push(projectId);
    filters.push(`lead.project_id=$${values.length}`);
  } else {
    const projectIds = getAccessibleProjectIds(scope.context.access);
    if (projectIds.length === 0) filters.push("FALSE");
    else {
      values.push(projectIds);
      filters.push(`lead.project_id=ANY($${values.length}::integer[])`);
    }
  }

  if (!scope.context.leadVisibility.canViewProjectWide) {
    values.push(scope.context.leadVisibility.userId);
    filters.push(`lead.current_owner_user_id=$${values.length}`);
  }

  try {
    const result = await pool.query(
      `SELECT
         next_action.lead_id,
         next_action.action_type,
         next_action.summary,
         next_action.notes,
         next_action.due_at,
         lead.project_id,
         project.project_name,
         lead.contact_id,
         lead.current_owner_user_id,
         contact.first_name,
         contact.last_name,
         owner.first_name AS assignee_first_name,
         owner.last_name AS assignee_last_name,
         COALESCE(preference.timezone, 'Asia/Kolkata') AS timezone
       FROM lead_next_actions next_action
       JOIN leads lead ON lead.lead_id=next_action.lead_id
       JOIN projects project ON project.project_id=lead.project_id
       JOIN contacts contact ON contact.contact_id=lead.contact_id
       LEFT JOIN users owner ON owner.user_id=lead.current_owner_user_id
       LEFT JOIN notification_preferences preference
         ON preference.user_id=$${values.length + 1}
       WHERE ${filters.join(" AND ")}
       ORDER BY next_action.due_at ASC, next_action.lead_id ASC
       LIMIT 1000`,
      [...values, scope.context.userId],
    );
    return NextResponse.json({ follow_ups: result.rows });
  } catch (error) {
    console.error("Failed to list calendar follow-ups", error);
    return NextResponse.json(
      { error: "Unable to retrieve follow-ups" },
      { status: 500 },
    );
  }
}
