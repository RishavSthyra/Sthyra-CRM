import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { requireOperationsContext } from "@/lib/operationsAccess";
import { canAccessProject, getAccessibleProjectIds } from "@/lib/projectAccess";
import { parsePositiveInteger } from "@/utils/parsePositiveInteger";

export async function GET(request: NextRequest) {
  const scope = await requireOperationsContext(request); if (!scope.ok) return scope.response;
  const values: unknown[] = [scope.context.access.company.company_id, getAccessibleProjectIds(scope.context.access)];
  const filters = ["tap.company_id=$1", "(tap.project_id IS NULL OR tap.project_id=ANY($2::integer[]))"];
  const projectValue = request.nextUrl.searchParams.get("project_id");
  if (projectValue) {
    const projectId = parsePositiveInteger(projectValue);
    if (!projectId || !canAccessProject(scope.context.access, projectId)) return NextResponse.json({ error: "Invalid or inaccessible project_id" }, { status: 400 });
    values.push(projectId); filters.push(`tap.project_id=$${values.length}`);
  }
  const status = request.nextUrl.searchParams.get("status");
  if (status) {
    if (!["offline", "available", "busy", "on_call", "away"].includes(status)) return NextResponse.json({ error: "Invalid presence status" }, { status: 400 });
    values.push(status); filters.push(`tap.status=$${values.length}`);
  }
  try {
    const result = await pool.query(
      `SELECT tap.*, u.first_name, u.last_name, u.email, t.team_name
       FROM telephony_agent_presence tap JOIN users u ON u.user_id=tap.user_id
       JOIN teams t ON t.team_id=u.team_id WHERE ${filters.join(" AND ")}
       ORDER BY CASE tap.status WHEN 'available' THEN 1 WHEN 'on_call' THEN 2 WHEN 'busy' THEN 3 WHEN 'away' THEN 4 ELSE 5 END, u.first_name, u.last_name`, values,
    );
    return NextResponse.json({ agents: result.rows });
  } catch (error) { console.error("Failed to retrieve agent presence", error); return NextResponse.json({ error: "Unable to retrieve agent presence" }, { status: 500 }); }
}
