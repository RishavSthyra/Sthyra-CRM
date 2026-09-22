import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { leadExists } from "@/lib/leadHistory";
import { parseLeadId } from "@/lib/leads";
import { parsePagination } from "@/utils/parsePagination";

type Context = { params: Promise<{ leadid: string }> };

export async function GET(request: NextRequest, context: Context) {
  const leadId = parseLeadId((await context.params).leadid);
  if (!leadId) {
    return NextResponse.json(
      { error: "leadId must be a valid UUID" },
      { status: 400 },
    );
  }
  const pagination = parsePagination(request.nextUrl.searchParams);
  if (!pagination.ok) {
    return NextResponse.json({ error: pagination.error }, { status: 400 });
  }

  try {
    if (!(await leadExists(pool, leadId))) {
      return NextResponse.json({ error: "Lead not found" }, { status: 404 });
    }
    const count = await pool.query(
      `SELECT COUNT(*)::integer AS total FROM lead_state_history
       WHERE lead_id=$1 AND from_stage_id IS DISTINCT FROM to_stage_id`,
      [leadId],
    );
    const result = await pool.query(
      `SELECT h.history_id, h.command, h.from_status, h.to_status,
              h.from_stage_id, h.to_stage_id, h.metadata,
              h.performed_by, h.created_at,
              CASE WHEN fs.stage_id IS NULL THEN NULL ELSE JSONB_BUILD_OBJECT(
                'stage_id', fs.stage_id, 'stage_key', fs.stage_key,
                'stage_name', fs.stage_name
              ) END AS from_stage,
              CASE WHEN ts.stage_id IS NULL THEN NULL ELSE JSONB_BUILD_OBJECT(
                'stage_id', ts.stage_id, 'stage_key', ts.stage_key,
                'stage_name', ts.stage_name
              ) END AS to_stage
       FROM lead_state_history h
       LEFT JOIN project_lead_stages fs ON fs.stage_id=h.from_stage_id
       LEFT JOIN project_lead_stages ts ON ts.stage_id=h.to_stage_id
       WHERE h.lead_id=$1 AND h.from_stage_id IS DISTINCT FROM h.to_stage_id
       ORDER BY h.created_at DESC, h.history_id DESC
       LIMIT $2 OFFSET $3`,
      [leadId, pagination.limit, pagination.offset],
    );
    const total = Number(count.rows[0]?.total ?? 0);
    return NextResponse.json({
      stage_history: result.rows,
      pagination: {
        page: pagination.page,
        limit: pagination.limit,
        total,
        totalPages: Math.ceil(total / pagination.limit),
      },
    });
  } catch (error) {
    console.error("Failed to retrieve lead stage history", error);
    return NextResponse.json(
      { error: "Unable to retrieve lead stage history" },
      { status: 500 },
    );
  }
}
