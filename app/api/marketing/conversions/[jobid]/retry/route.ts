import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { requirePermission } from "@/lib/authorization";
import { isUuid } from "@/lib/permissions";

type Context = { params: Promise<{ jobid: string }> };

export async function POST(request: NextRequest, context: Context) {
  const scope = await requirePermission(request, "WORKSPACE_MANAGE");
  if (!scope.ok) return scope.response;
  if (!scope.context.access.canViewAllProjects) return NextResponse.json({ error: "Company administrator access is required" }, { status: 403 });
  const id = (await context.params).jobid;
  if (!isUuid(id)) return NextResponse.json({ error: "Invalid conversion job ID" }, { status: 400 });
  try {
    const result = await pool.query(
      `UPDATE marketing_conversion_jobs
       SET status='queued', attempt_count=0, next_attempt_at=CURRENT_TIMESTAMP,
           last_error=NULL, updated_at=CURRENT_TIMESTAMP
       WHERE company_id=$1 AND conversion_job_id=$2 AND status IN ('failed','discarded')
       RETURNING conversion_job_id, status`,
      [scope.context.access.company.company_id, id],
    );
    if (!result.rowCount) return NextResponse.json({ error: "Retryable conversion job not found" }, { status: 404 });
    return NextResponse.json({ conversion: result.rows[0] });
  } catch (error) {
    console.error("Unable to retry conversion", error);
    return NextResponse.json({ error: "Unable to retry conversion" }, { status: 500 });
  }
}
